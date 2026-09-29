"use client";

// ① 메시지 구독·동기화·전송. 실시간 구독은 영역마다 따로 연다 (미읽음은 ②, 알림은 ③).

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import type { ChatMessage, ConnectionState, PendingMessage } from "@/lib/types/message";

const SEND_TIMEOUT_MS = 5000;
const INITIAL_HISTORY = 50;

// crypto.randomUUID 는 localhost·https 에서만 된다. 같은 네트워크의 IP(http)로 접속해도 되도록 직접 만든다.
export function newClientId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sendErrorMessage(error: { code?: string; message?: string; name?: string }) {
  if (error.name === "AbortError" || error.code === "20") return "서버 응답이 없습니다";
  if (error.code === "23514") return "빈 메시지이거나 너무 깁니다";
  if (!navigator.onLine || /fetch/i.test(error.message ?? "")) return "연결이 끊겨 보내지 못했습니다";
  return error.message ?? "보내지 못했습니다";
}

export function useMessages(nickname: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [conn, setConn] = useState<ConnectionState>("connecting");
  const [online, setOnline] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const lastIdRef = useRef(0);

  // 서버 id 를 키로 합친다. 같은 메시지가 실시간·동기화로 두 번 와도 한 번만 그린다.
  const merge = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      const next = [...byId.values()].sort((a, b) => a.id - b.id);
      lastIdRef.current = next[next.length - 1].id;
      return next;
    });
    const saved = new Set(incoming.map((m) => m.client_id));
    setPending((prev) => prev.filter((p) => !saved.has(p.clientId)));
  }, []);

  // 처음엔 최근 50건, 재연결 뒤엔 마지막으로 받은 id 이후만 받아 온다
  const sync = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    const query = supabase.from("messages").select("*");
    const { data, error } =
      lastIdRef.current > 0
        ? await query.gt("id", lastIdRef.current).order("id", { ascending: true }).limit(500)
        : await query.order("id", { ascending: false }).limit(INITIAL_HISTORY);
    if (!error && data) merge(data as ChatMessage[]);
  }, [merge]);

  useEffect(() => {
    let supabase: SupabaseClient;
    try {
      supabase = getSupabase();
    } catch (e) {
      setFatal((e as Error).message);
      return;
    }
    supabaseRef.current = supabase;

    let resyncTimer: ReturnType<typeof setTimeout> | undefined;
    const channel: RealtimeChannel = supabase.channel("room:general", {
      config: { presence: { key: newClientId() } },
    });

    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => merge([payload.new as ChatMessage]),
      )
      .on("presence", { event: "sync" }, () => {
        setOnline(Object.keys(channel.presenceState()).length);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConn("connected");
          void sync();
          // 구독 직후 잠깐은 실시간 이벤트가 빠질 수 있다 (2026-09-28 첫 테스트에서 확인). 한 번 더 맞춘다.
          resyncTimer = setTimeout(() => void sync(), 2000);
          void channel.track({ nickname });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConn("reconnecting"); // supabase-js 가 자동으로 다시 붙는다
        } else if (status === "CLOSED") {
          setConn("disconnected");
        }
      });

    const goOffline = () => setConn("disconnected");
    const goOnline = () => setConn("reconnecting");
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    return () => {
      clearTimeout(resyncTimer);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      void supabase.removeChannel(channel);
      supabaseRef.current = null;
    };
  }, [nickname, merge, sync]);

  async function send(body: string, clientId = newClientId()) {
    const text = body.trim();
    const supabase = supabaseRef.current;
    if (!text || !supabase) return;

    const mark = (status: PendingMessage["status"], error?: string) =>
      setPending((prev) => {
        const rest = prev.filter((p) => p.clientId !== clientId);
        return [...rest, { clientId, author: nickname, body: text, status, error }];
      });

    if (!navigator.onLine) {
      mark("failed", "연결이 끊겨 보내지 못했습니다");
      return;
    }
    mark("sending");

    try {
      // 같은 client_id 가 이미 있으면 저장하지 않는다 (ON CONFLICT DO NOTHING)
      const { data, error } = await supabase
        .from("messages")
        .upsert(
          { client_id: clientId, author: nickname, body: text },
          { onConflict: "client_id", ignoreDuplicates: true },
        )
        .select()
        .abortSignal(AbortSignal.timeout(SEND_TIMEOUT_MS));
      if (error) return mark("failed", sendErrorMessage(error));
      if (data && data.length > 0) return merge(data as ChatMessage[]);

      // 이미 저장돼 있던 메시지 (다시 보내기): 저장된 것을 가져와 합친다
      const existing = await supabase.from("messages").select("*").eq("client_id", clientId);
      if (existing.data?.length) merge(existing.data as ChatMessage[]);
    } catch (e) {
      mark("failed", sendErrorMessage(e as Error));
    }
  }

  function discard(clientId: string) {
    setPending((prev) => prev.filter((p) => p.clientId !== clientId));
  }

  return { messages, pending, conn, online, fatal, send, discard };
}
