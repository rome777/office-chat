"use client";

// ① 고정 메시지 (pinned_messages, 20260930170000_chat_extras.sql). 채널 멤버 누구나 고정·해제한다 (toggle_pin RPC).
// 메시지 메뉴의 "고정"과 채널 정보의 "고정된 메시지"가 이 저장소를 같이 본다. 실시간은 없다 — 고치면 다시 불러온다.

import { useEffect, useSyncExternalStore } from "react";
import { getSupabase } from "@/lib/supabase";

export type Pin = { message_id: number; pinned_at: string; body: string; user_id: string | null; created_at: string };

const cache = new Map<string, Pin[]>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

async function load(channelId: string) {
  const { data, error } = await getSupabase()
    .from("pinned_messages")
    .select("message_id, pinned_at, messages(body, user_id, created_at)")
    .eq("channel_id", channelId)
    .order("pinned_at", { ascending: false })
    .limit(50);
  cache.set(
    channelId,
    error
      ? []
      : (data ?? []).map((r) => {
          const m = r.messages as unknown as { body: string; user_id: string | null; created_at: string } | null;
          return { message_id: r.message_id as number, pinned_at: r.pinned_at as string, body: m?.body ?? "", user_id: m?.user_id ?? null, created_at: m?.created_at ?? r.pinned_at };
        }),
  );
  notify();
}

const EMPTY: Pin[] = [];

export function usePins(channelId: string): Pin[] {
  useEffect(() => {
    if (channelId) void load(channelId);
  }, [channelId]);
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => cache.get(channelId) ?? EMPTY,
    () => EMPTY,
  );
}

export async function togglePin(channelId: string, messageId: number): Promise<boolean> {
  const { data, error } = await getSupabase().rpc("toggle_pin", { p_message: messageId });
  if (error) throw new Error(error.message);
  await load(channelId);
  return data as boolean;
}
