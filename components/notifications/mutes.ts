"use client";

// ③ 채널별 알림 끄기 (channel_mutes, 20260930170000_chat_extras.sql). 끈 채널의 메시지 알림은 DB 가 아예 만들지 않는다.
// 채널 정보의 "알림 설정"과 메시지 목록의 종 표시가 같이 본다. 미읽음 배지는 그대로 보인다.

import { useSyncExternalStore } from "react";
import { getSupabase } from "@/lib/supabase";

let ids: ReadonlySet<string> = new Set();
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

async function load() {
  const { data, error } = await getSupabase().from("channel_mutes").select("channel_id");
  ids = new Set(error ? [] : (data ?? []).map((r) => r.channel_id as string));
  loaded = true;
  notify();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!loaded) loading ??= load().finally(() => (loading = null));
  return () => void listeners.delete(fn);
}

const EMPTY: ReadonlySet<string> = new Set();

export function useMutedChannels(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => ids, () => EMPTY);
}

export async function setMuted(channelId: string, muted: boolean) {
  if (ids.has(channelId) === muted) return;
  const next = new Set(ids);
  if (muted) next.add(channelId);
  else next.delete(channelId);
  ids = next;
  notify();
  const table = getSupabase().from("channel_mutes");
  const { error } = muted
    ? await table.insert({ channel_id: channelId })
    : await table.delete().eq("channel_id", channelId);
  if (error) {
    await load();
    throw new Error(error.message);
  }
}
