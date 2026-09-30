"use client";

// 내 즐겨찾기 채널·DM (channel_favorites, 20260930170000_chat_extras.sql). 본인 것만 읽고 쓴다 (RLS).
// 메시지 목록·채팅 머리의 별·대시보드가 이 저장소 하나를 같이 본다.

import { useSyncExternalStore } from "react";
import { getSupabase } from "@/lib/supabase";

let ids: ReadonlySet<string> = new Set();
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

async function load() {
  const { data, error } = await getSupabase().from("channel_favorites").select("channel_id");
  // 마이그레이션 전이거나 실패하면 즐겨찾기가 없는 것처럼 둔다 (목록은 그대로 보인다)
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

export function useFavorites(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => ids, () => EMPTY);
}

/** 켜져 있으면 끄고, 꺼져 있으면 켠다. 화면은 먼저 바꾸고 DB 가 거부하면 되돌린다 */
export async function toggleFavorite(channelId: string) {
  const on = ids.has(channelId);
  const next = new Set(ids);
  if (on) next.delete(channelId);
  else next.add(channelId);
  ids = next;
  notify();
  const table = getSupabase().from("channel_favorites");
  const { error } = on
    ? await table.delete().eq("channel_id", channelId)
    : await table.insert({ channel_id: channelId });
  if (error) {
    await load();
    throw new Error(error.code === "42P01" ? "즐겨찾기 표가 아직 없습니다 (마이그레이션 적용 전)" : error.message);
  }
}
