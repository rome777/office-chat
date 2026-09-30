"use client";

// ① 메시지 구독·동기화·전송. 실시간 구독은 영역마다 따로 연다 (미읽음은 ②, 알림은 ③).
// 보고 있는 채널의 최상위 메시지만 다룬다. 답글(parent_id 가 있는 것)은 스레드 패널이 따로 받는다.

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { useMyProfile } from "@/components/profile/profileSource"; // ② 내 상태 (오프라인으로 표시)
import type {
  ChatMessage,
  ConnectionState,
  MessageAttachment,
  PendingMessage,
} from "@/lib/types/message";

/** 조회 결과. 첨부는 attachments 를 함께 받는다 (FK 로 붙여 조회) */
type MessageRow = ChatMessage & { attachments?: MessageAttachment[] };

const ATTACHMENT_COLUMNS = "id, message_id, mime, size, file_name";

const SEND_TIMEOUT_MS = 5000;
/** 처음 열 때와 위로 올릴 때 한 번에 받는 수 (TECH_SPEC 7절 페이지네이션) */
const PAGE_SIZE = 50;
/** 목표 메시지까지 사이를 채우거나, 재연결 뒤 놓친 것을 이어 받을 때 한 번에 받는 수. Supabase 한 번 조회 상한(1000행)과 같다 */
const RANGE_CHUNK = 1000;
/** 이동한 메시지 위로 더 불러 두는 수 (앞 맥락) */
const JUMP_CONTEXT = 10;

// crypto.randomUUID 는 localhost·https 에서만 된다. 같은 네트워크의 IP(http)로 접속해도 되도록 직접 만든다.
export function newClientId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function sendErrorMessage(error: { code?: string; message?: string; name?: string }) {
  if (error.name === "AbortError" || error.code === "20") return "서버 응답이 없습니다";
  if (error.code === "23514") return "빈 메시지이거나 너무 깁니다";
  if (error.code === "42501") return "이 대화에 보낼 권한이 없습니다";
  if (/exceeded|too large|payload/i.test(error.message ?? "")) return "5MB 이하만 올릴 수 있습니다";
  if (!navigator.onLine || /fetch/i.test(error.message ?? "")) return "연결이 끊겨 보내지 못했습니다";
  return error.message ?? "보내지 못했습니다";
}

export function useMessages(channelId: string, myName: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [conn, setConn] = useState<ConnectionState>("connecting");
  const [online, setOnline] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);
  /** 처음 불러오기가 끝난 채널 id. 메시지로 이동은 이것이 이동할 채널과 같아질 때까지 기다린다 */
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** 작성자 id → 표시 이름. 실시간으로 온 행에는 이름이 없어서 profiles 에서 찾아 둔다 */
  const [names, setNames] = useState<Record<string, string>>({});
  /** 메시지 id → 첨부. 메시지와 첨부는 실시간 이벤트가 따로 와서 따로 모은다 */
  const [attachments, setAttachments] = useState<Record<number, MessageAttachment[]>>({});

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const channelRef = useRef(channelId);
  const askedNamesRef = useRef(new Set<string>());
  // 목록은 항상 "가장 오래 받은 것 ~ 최신"이 빈틈없이 이어진다. 두 끝의 id 를 기억한다.
  const lastIdRef = useRef(0);
  const oldestIdRef = useRef(0);
  const loadingOlderRef = useRef(false);
  // "오프라인으로 표시"(② 내 프로필)면 접속자 수에 넣지 않는다 — 넣으면 숨긴 사람이 접속해 있다는 것이 드러난다.
  // 내 상태를 읽기 전에는 들어가지 않는다 (먼저 들어갔다 나가면 그 잠깐 사이 접속이 드러난다). 못 읽으면 예전처럼 들어간다
  const mySelf = useMyProfile();
  const hidden = !(mySelf.profile ? mySelf.profile.status !== "invisible" : !!mySelf.error);
  const invisibleRef = useRef(hidden);
  const roomRef = useRef<RealtimeChannel | null>(null);

  const resolveNames = useCallback(async (list: ChatMessage[]) => {
    const supabase = supabaseRef.current;
    const ids = [...new Set(list.map((m) => m.user_id).filter((id): id is string => !!id))].filter(
      (id) => !askedNamesRef.current.has(id),
    );
    if (!supabase || ids.length === 0) return;
    ids.forEach((id) => askedNamesRef.current.add(id));
    const { data } = await supabase.from("profiles").select("id, display_name").in("id", ids);
    if (data?.length) {
      setNames((prev) => ({ ...prev, ...Object.fromEntries(data.map((p) => [p.id, p.display_name])) }));
    }
  }, []);

  const addAttachments = useCallback((list: MessageAttachment[]) => {
    if (list.length === 0) return;
    setAttachments((prev) => {
      const next = { ...prev };
      for (const a of list) {
        const current = next[a.message_id] ?? [];
        if (!current.some((x) => x.id === a.id)) next[a.message_id] = [...current, a];
      }
      return next;
    });
  }, []);

  // 서버 id 를 키로 합친다. 같은 메시지가 실시간·동기화로 두 번 와도 한 번만 그린다.
  // 채널을 바꾼 뒤 늦게 도착한 옛 채널 응답은 버린다.
  const merge = useCallback((rows: MessageRow[]) => {
    const raw = rows.map(({ attachments: files, ...m }) => {
      if (files?.length) addAttachments(files);
      return m as ChatMessage;
    });
    const incoming = raw.filter((m) => m.channel_id === channelRef.current && m.parent_id === null);
    if (incoming.length === 0) return;
    void resolveNames(incoming);
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      const next = [...byId.values()].sort((a, b) => a.id - b.id);
      oldestIdRef.current = next[0].id;
      lastIdRef.current = next[next.length - 1].id;
      return next;
    });
    const saved = new Set(incoming.map((m) => m.client_id));
    setPending((prev) => prev.filter((p) => !saved.has(p.clientId)));
  }, [resolveNames, addAttachments]);

  // 이 채널의 최상위 메시지 조회
  const query = useCallback(
    (supabase: SupabaseClient) =>
      supabase
        .from("messages")
        .select(`*, attachments(${ATTACHMENT_COLUMNS})`)
        .eq("channel_id", channelId)
        .is("parent_id", null),
    [channelId],
  );

  // 처음엔 최근 50건, 재연결 뒤엔 마지막으로 받은 id 이후만 받아 온다
  const sync = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    if (lastIdRef.current === 0) {
      const { data, error } = await query(supabase)
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);
      if (error || !data) return;
      merge(data as ChatMessage[]);
      setHasOlder(data.length === PAGE_SIZE);
      setReadyFor(channelRef.current);
      return;
    }
    // 끊긴 동안 쌓인 것은 끝까지 이어 받는다. 한 번에 다 받으면 조회 상한에 걸려 뒤쪽이 빠진다
    let after = lastIdRef.current;
    for (;;) {
      const { data, error } = await query(supabase)
        .gt("id", after)
        .order("id", { ascending: true })
        .limit(RANGE_CHUNK);
      if (error || !data || data.length === 0) return;
      merge(data as ChatMessage[]);
      after = data[data.length - 1].id;
      if (data.length < RANGE_CHUNK) return;
    }
  }, [merge, query]);

  // 위로 올리면 가장 오래 받은 것보다 앞의 50건을 붙인다 (키셋: id < 커서)
  const loadOlder = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase || loadingOlderRef.current || oldestIdRef.current === 0) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const { data, error } = await query(supabase)
        .lt("id", oldestIdRef.current)
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);
      if (error || !data) return;
      merge(data as ChatMessage[]);
      setHasOlder(data.length === PAGE_SIZE);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [merge, query]);

  // 메시지로 이동(`?m=`) 전에 그 메시지를 목록에 올려 둔다. 받은 범위보다 오래됐으면 사이를 모두 채운다.
  // 있는지는 화면(MessageList)이 확인한다. 조회에 실패하면 false.
  const reveal = useCallback(
    async (targetId: number): Promise<boolean> => {
      const supabase = supabaseRef.current;
      if (!supabase) return false;
      if (targetId > lastIdRef.current) await sync(); // 방금 온 메시지일 수 있다
      let oldest = oldestIdRef.current;
      if (oldest === 0 || targetId >= oldest) return true;

      loadingOlderRef.current = true;
      setLoadingOlder(true);
      try {
        while (oldest > targetId) {
          const { data, error } = await query(supabase)
            .lt("id", oldest)
            .gte("id", targetId)
            .order("id", { ascending: false })
            .limit(RANGE_CHUNK);
          if (error || !data) return false;
          if (data.length === 0) break;
          merge(data as ChatMessage[]);
          oldest = data[data.length - 1].id;
          if (data.length < RANGE_CHUNK) break;
        }
        const { data, error } = await query(supabase)
          .lt("id", Math.min(oldest, targetId))
          .order("id", { ascending: false })
          .limit(JUMP_CONTEXT);
        if (error || !data) return false;
        merge(data as ChatMessage[]);
        setHasOlder(data.length === JUMP_CONTEXT);
        return true;
      } finally {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    },
    [merge, sync, query],
  );

  useEffect(() => {
    let supabase: SupabaseClient;
    try {
      supabase = getSupabase();
    } catch (e) {
      setFatal((e as Error).message);
      return;
    }
    supabaseRef.current = supabase;

    // 채널을 바꾸면 처음부터 다시 받는다
    channelRef.current = channelId;
    lastIdRef.current = 0;
    oldestIdRef.current = 0;
    setMessages([]);
    setPending([]);
    setAttachments({});
    setReadyFor(null);
    setHasOlder(false);

    let resyncTimer: ReturnType<typeof setTimeout> | undefined;
    // 접속자 수(presence)는 모든 사람이 같은 이름으로 들어가야 세어진다. 그래서 이 구독만 이름에 꼬리를 붙이지 않는다
    const channel: RealtimeChannel = supabase.channel(`room:${channelId}`, {
      config: { presence: { key: newClientId() } },
    });
    roomRef.current = channel;

    channel
      .on(
        "postgres_changes",
        // RLS 가 구독자마다 걸러서 보낸다. 멤버가 아니면 오지 않는다
        { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
        (payload) => merge([payload.new as ChatMessage]),
      )
      // 답글 수(reply_count)가 오르거나 본문을 고치면 부모 행이 바뀐다
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
        (payload) => merge([payload.new as ChatMessage]),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "attachments", filter: `channel_id=eq.${channelId}` },
        (payload) => addAttachments([payload.new as MessageAttachment]),
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
          if (!invisibleRef.current) void channel.track({ name: myName });
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
      roomRef.current = null;
    };
  }, [channelId, myName, merge, sync, addAttachments]);

  // 내 상태를 읽었을 때, 보고 있는 중에 "오프라인으로 표시"를 켜고 끌 때 접속자 수에 넣고 뺀다
  useEffect(() => {
    invisibleRef.current = hidden;
    const room = roomRef.current;
    if (!room || room.state !== "joined") return;
    if (hidden) void room.untrack();
    else void room.track({ name: myName });
  }, [hidden, myName]);


  async function send(body: string, clientId = newClientId(), file?: File) {
    const text = body.trim();
    const supabase = supabaseRef.current;
    if ((!text && !file) || !supabase) return;

    const mark = (status: PendingMessage["status"], error?: string) =>
      setPending((prev) => {
        const rest = prev.filter((p) => p.clientId !== clientId);
        return [...rest, { clientId, author: myName, body: text, status, error, file }];
      });

    if (!navigator.onLine) {
      mark("failed", "연결이 끊겨 보내지 못했습니다");
      return;
    }
    mark("sending");

    if (file) {
      const failure = await sendFile(supabase, clientId, text, file);
      if (failure) mark("failed", failure);
      return;
    }

    try {
      // 같은 client_id 가 이미 있으면 저장하지 않는다 (ON CONFLICT DO NOTHING)
      const { data, error } = await supabase
        .from("messages")
        .upsert(
          { client_id: clientId, channel_id: channelId, body: text },
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

  // 첨부: 업로드 주소 받기 → Storage 로 바로 올리기 → 서버가 시그니처 검사 뒤 메시지·첨부 저장 (TECH_SPEC 7절).
  // 실패하면 오류 문구를, 성공하면 null 을 돌려준다
  async function sendFile(
    supabase: SupabaseClient,
    clientId: string,
    text: string,
    file: File,
  ): Promise<string | null> {
    try {
      const signRes = await fetch("/api/attachments/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, file_name: file.name, size: file.size, mime: file.type }),
      });
      const sign = await signRes.json().catch(() => ({}));
      if (!signRes.ok) return sign.error ?? "업로드 주소를 받지 못했습니다";

      const upload = await supabase.storage
        .from("attachments")
        .uploadToSignedUrl(sign.path, sign.token, file, { contentType: file.type });
      if (upload.error) return sendErrorMessage(upload.error);

      const confirmRes = await fetch("/api/attachments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: channelId,
          path: sign.path,
          file_name: file.name,
          client_id: clientId,
          body: text,
        }),
      });
      const saved = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok) return saved.error ?? "파일을 저장하지 못했습니다";
      addAttachments([saved.attachment as MessageAttachment]);
      merge([saved.message as ChatMessage]);
      return null;
    } catch (e) {
      return sendErrorMessage(e as Error);
    }
  }

  function discard(clientId: string) {
    setPending((prev) => prev.filter((p) => p.clientId !== clientId));
  }

  return {
    messages,
    pending,
    conn,
    online,
    fatal,
    names,
    attachments,
    readyFor,
    hasOlder,
    loadingOlder,
    send,
    discard,
    loadOlder,
    reveal,
  };
}
