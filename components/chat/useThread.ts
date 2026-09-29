"use client";

// ① 스레드 한 개: 부모 메시지와 답글, 답글 보내기. 오른쪽 패널의 스레드(ThreadPanel)가 쓴다.
// 답글은 채널 본문(useMessages)에는 오지 않는다. 여기서 parent_id 로 따로 구독한다.

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { ChatMessage, MessageAttachment, PendingMessage } from "@/lib/types/message";
import { newClientId, sendErrorMessage } from "./useMessages";

const SEND_TIMEOUT_MS = 5000;
type Row = ChatMessage & { attachments?: MessageAttachment[] };

export function useThread(parentId: number, myName: string) {
  const [parent, setParent] = useState<Row | null>(null);
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  /** 부모 메시지를 볼 수 없다 (지워졌거나 멤버가 아님) */
  const [missing, setMissing] = useState(false);

  const merge = useCallback((incoming: ChatMessage[]) => {
    const mine = incoming.filter((m) => m.parent_id === parentId);
    if (mine.length === 0) return;
    setReplies((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of mine) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
    const saved = new Set(mine.map((m) => m.client_id));
    setPending((prev) => prev.filter((p) => !saved.has(p.clientId)));
  }, [parentId]);

  useEffect(() => {
    const supabase = getSupabase();
    let alive = true;
    setParent(null);
    setReplies([]);
    setPending([]);
    setMissing(false);

    async function load() {
      const [p, r] = await Promise.all([
        supabase
          .from("messages")
          .select("*, attachments(id, message_id, mime, size, file_name)")
          .eq("id", parentId)
          .maybeSingle(),
        supabase.from("messages").select("*").eq("parent_id", parentId).order("id").limit(1000),
      ]);
      if (!alive) return;
      if (!p.data) {
        setMissing(true);
        return;
      }
      setParent(p.data as Row);
      if (r.data) merge(r.data as ChatMessage[]);
    }

    // 구독 이름에 매번 고유한 꼬리를 붙인다. supabase.channel() 은 같은 이름이 있으면 이미 구독한 채널을 돌려주고,
    // 거기에 .on() 을 붙이면 "cannot add postgres_changes callbacks after subscribe()" 로 화면 전체가 멈춘다 (2026-09-29)
    const channel = supabase
      .channel(`thread:${parentId}:${newClientId()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `parent_id=eq.${parentId}` },
        (payload) => merge([payload.new as ChatMessage]),
      )
      .subscribe((status) => {
        // 구독 전·끊긴 동안 달린 답글은 다시 불러와 맞춘다
        if (status === "SUBSCRIBED") void load();
      });

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [parentId, merge]);

  async function send(body: string, clientId = newClientId()) {
    const text = body.trim();
    if (!text || !parent) return;
    const mark = (status: PendingMessage["status"], error?: string) =>
      setPending((prev) => [
        ...prev.filter((p) => p.clientId !== clientId),
        { clientId, author: myName, body: text, status, error },
      ]);
    if (!navigator.onLine) return mark("failed", "연결이 끊겨 보내지 못했습니다");
    mark("sending");

    const supabase = getSupabase();
    try {
      // 같은 client_id 가 이미 있으면 저장하지 않는다 (다시 보내기도 한 번만 저장)
      const { data, error } = await supabase
        .from("messages")
        .upsert(
          { client_id: clientId, channel_id: parent.channel_id, parent_id: parentId, body: text },
          { onConflict: "client_id", ignoreDuplicates: true },
        )
        .select()
        .abortSignal(AbortSignal.timeout(SEND_TIMEOUT_MS));
      if (error) return mark("failed", sendErrorMessage(error));
      if (data && data.length > 0) return merge(data as ChatMessage[]);
      const existing = await supabase.from("messages").select("*").eq("client_id", clientId);
      if (existing.data?.length) merge(existing.data as ChatMessage[]);
    } catch (e) {
      mark("failed", sendErrorMessage(e as Error));
    }
  }

  function discard(clientId: string) {
    setPending((prev) => prev.filter((p) => p.clientId !== clientId));
  }

  return { parent, replies, pending, missing, send, discard };
}
