"use client";

// 채널 하나의 설명·만든 사람·부서 채널 여부 (채팅 머리와 채널 정보 패널이 같이 본다).
// 설명·이름은 만든 사람과 관리자만 고친다 (RLS "만든 사람·관리자가 채널 수정"). 부서 채널 이름은 DB 가 막는다.

import { useEffect, useSyncExternalStore } from "react";
import type { ChannelType } from "@/lib/types/channel";
import { getSupabase } from "@/lib/supabase";
import { channelNameProblem, cleanName, notifyChannelsChanged } from "@/components/sidebar/channelSource";

export const DESCRIPTION_MAX = 120;

export type ChannelDetails = {
  id: string;
  name: string;
  type: ChannelType;
  description: string;
  created_by: string | null;
  /** 조직(부서) 채널이면 true — 이름이 조직 이름을 따라간다 */
  org: boolean;
};

const cache = new Map<string, ChannelDetails | null>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

async function load(id: string) {
  const supabase = getSupabase();
  const [ch, org] = await Promise.all([
    supabase.from("channels").select("id, name, type, description, created_by").eq("id", id).maybeSingle(),
    supabase.from("org_units").select("id").eq("channel_id", id).limit(1),
  ]);
  let row = ch.data as Omit<ChannelDetails, "org"> | null;
  // 마이그레이션 전(description 칸 없음)이면 설명 없이 다시 읽는다
  if (ch.error) {
    const again = await supabase.from("channels").select("id, name, type, created_by").eq("id", id).maybeSingle();
    row = again.data ? { ...(again.data as Omit<ChannelDetails, "org" | "description">), description: "" } : null;
  }
  cache.set(id, row ? { ...row, name: row.name ?? "", description: row.description ?? "", org: (org.data ?? []).length > 0 } : null);
  notify();
}

function ensure(id: string) {
  if (!id || cache.has(id) || inFlight.has(id)) return;
  inFlight.set(id, load(id).finally(() => inFlight.delete(id)));
}

export function useChannelDetails(id: string): ChannelDetails | null {
  useEffect(() => ensure(id), [id]);
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => cache.get(id) ?? null,
    () => null,
  );
}

/** 이름·설명을 고친다. 권한이 없으면 RLS 가 0건을 고치므로 돌려받은 행 수로 확인한다 */
export async function updateChannel(id: string, patch: { name?: string; description?: string }) {
  const body: { name?: string; description?: string } = {};
  if (patch.name !== undefined) {
    const problem = channelNameProblem(patch.name);
    if (problem) throw new Error(problem);
    body.name = cleanName(patch.name);
  }
  if (patch.description !== undefined) {
    const d = patch.description.trim();
    if ([...d].length > DESCRIPTION_MAX) throw new Error(`설명은 ${DESCRIPTION_MAX}자까지입니다`);
    body.description = d;
  }
  const { data, error } = await getSupabase().from("channels").update(body).eq("id", id).select("id");
  if (error) throw new Error(error.code === "42501" ? error.message || "권한이 없습니다" : error.message);
  if (!data?.length) throw new Error("만든 사람이나 관리자만 고칠 수 있습니다");
  cache.delete(id);
  ensure(id);
  if (body.name) notifyChannelsChanged();
}
