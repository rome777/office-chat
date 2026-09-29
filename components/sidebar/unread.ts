"use client";

// ② 채널 목록의 미읽음 배지 (F3-3). 왼쪽 칸과 헤더의 채널 목록이 이 저장소 하나를 같이 본다.
//
// 미읽음 수 = 내 read_positions.last_read_message_id 보다 큰, 남이 쓴 최상위 메시지 수 (TECH_SPEC 7절).
// ① 이 "화면에 보인 마지막 최상위 메시지"로 읽음을 남기므로(useReadStatus), 답글·지운 메시지는 세지 않는다
// — 답글까지 세면 스레드에만 답이 달린 채널은 배지가 영영 줄지 않는다.
// Step 1 익명 메시지(user_id 없음)는 남이 쓴 것으로 센다.
//
// 실시간: messages(내가 볼 수 있는 행만 온다, RLS)와 내 read_positions 를 구독해서 그 채널만 다시 센다.
// 가입·탈퇴는 채널 목록의 실시간 구독(subscribeChannels)이 알려 주면 전부 다시 센다.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { getMyUserId, subscribeChannels } from "./channelSource";

const counts = new Map<string, number>();
const listeners = new Set<() => void>();
let live: RealtimeChannel | null = null;
let liveSeq = 0;
let stopChannels: (() => void) | null = null;
let me: string | null = null;
let refreshSeq = 0;
const pending = new Map<string, ReturnType<typeof setTimeout>>();
// 채널마다 "몇 번째 세기인지" 번호표. 늦게 끝난 옛 세기가 새 결과를 덮지 않게, 가장 최근 번호의 결과만 쓴다
const version = new Map<string, number>();
const bump = (id: string) => {
  const v = (version.get(id) ?? 0) + 1;
  version.set(id, v);
  return v;
};
let retry: ReturnType<typeof setTimeout> | null = null;

const notify = () => listeners.forEach((fn) => fn());

/** 채널의 미읽음 수 (모르면 0) */
export const getUnread = (channelId: string) => counts.get(channelId) ?? 0;

/** 미읽음 수가 바뀌면 알려 준다. 처음 쓰는 곳이 생기면 불러오고 구독을 연다 */
export function subscribeUnread(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) stop();
  };
}

function start() {
  stopChannels = subscribeChannels(() => void refreshAll());
  void startLive();
  void refreshAll();
}

function stop() {
  stopChannels?.();
  stopChannels = null;
  if (live) void getSupabase().removeChannel(live);
  live = null;
  pending.forEach(clearTimeout);
  pending.clear();
  if (retry) clearTimeout(retry);
  retry = null;
  // 다시 켜질 때 옛 숫자·옛 사용자가 남지 않게
  refreshSeq++;
  counts.clear();
  me = null;
}

type Row = { channel_id?: string; parent_id?: number | null; user_id?: string | null; deleted_at?: string | null };

async function startLive() {
  me = await getMyUserId().catch(() => null);
  if (live || listeners.size === 0) return;
  if (!me) {
    // 세션을 아직 못 읽었으면 잠시 뒤 다시 시도한다 (배지가 멈춘 채로 남지 않게)
    retry = setTimeout(() => {
      retry = null;
      void startLive();
    }, 3000);
    return;
  }
  const topLevel = (row: Row | undefined): row is Row & { channel_id: string } =>
    Boolean(row?.channel_id) && row!.parent_id == null;
  live = getSupabase()
    // 떠나는 중인 이전 구독과 이름이 겹치지 않게 매번 새 이름
    .channel(`unread:${me}:${++liveSeq}`)
    // 내가 쓴 메시지는 미읽음이 아니다
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
      const row = p.new as Row;
      if (topLevel(row) && row.user_id !== me) schedule(row.channel_id);
    })
    // 지운 메시지(deleted_at)만 다시 센다. 답글 수·수정 같은 다른 UPDATE 는 숫자를 바꾸지 않는다
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (p) => {
      const row = p.new as Row;
      if (topLevel(row) && row.deleted_at) schedule(row.channel_id);
    })
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "read_positions", filter: `user_id=eq.${me}` },
      (p) => {
        const row = (p.new ?? p.old) as { channel_id?: string } | undefined;
        if (row?.channel_id) schedule(row.channel_id);
      },
    )
    // 구독이 붙기 전(또는 끊겼다 다시 붙는 동안) 온 메시지는 이벤트로 오지 않으므로, 붙을 때마다 다시 센다
    .subscribe((status) => {
      if (status === "SUBSCRIBED") void refreshAll();
    });
}

/** 메시지가 몰려 와도 채널마다 잠깐 모아서 한 번만 센다 */
function schedule(channelId: string) {
  clearTimeout(pending.get(channelId));
  pending.set(
    channelId,
    setTimeout(() => {
      pending.delete(channelId);
      void recount(channelId);
    }, 300),
  );
}

async function lastRead(channelIds: string[]): Promise<Map<string, number>> {
  const { data, error } = await getSupabase()
    .from("read_positions")
    .select("channel_id, last_read_message_id")
    .eq("user_id", me!)
    .in("channel_id", channelIds);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.channel_id as string, Number(r.last_read_message_id)]));
}

async function countAfter(channelId: string, after: number): Promise<number> {
  const { count, error } = await getSupabase()
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .is("parent_id", null)
    .is("deleted_at", null)
    .gt("id", after)
    .or(`user_id.is.null,user_id.neq.${me}`);
  if (error) throw error;
  return count ?? 0;
}

async function refreshAll() {
  const seq = ++refreshSeq;
  try {
    me ??= await getMyUserId();
    const { data, error } = await getSupabase()
      .from("memberships")
      .select("channel_id")
      .eq("user_id", me);
    if (error) throw error;
    const ids = (data ?? []).map((m) => m.channel_id as string);
    // 시작할 때의 번호표. 그 사이 그 채널을 따로 다시 셌으면(recount) 그쪽이 더 새 결과다
    const started = new Map(ids.map((id) => [id, version.get(id) ?? 0]));
    const read = ids.length ? await lastRead(ids) : new Map<string, number>();
    const values = await Promise.all(ids.map((id) => countAfter(id, read.get(id) ?? 0)));
    if (seq !== refreshSeq) return; // 더 새 전체 세기가 있으면 버린다
    const keep = new Set(ids);
    for (const id of [...counts.keys()]) if (!keep.has(id)) counts.delete(id); // 나간 채널
    ids.forEach((id, i) => {
      if ((version.get(id) ?? 0) === started.get(id)) counts.set(id, values[i]);
    });
    notify();
  } catch {
    // 배지는 보조 정보다. 실패하면 이전 숫자를 두고 다음 이벤트 때 다시 센다
  }
}

async function recount(channelId: string) {
  const v = bump(channelId);
  try {
    me ??= await getMyUserId();
    const read = await lastRead([channelId]);
    const n = await countAfter(channelId, read.get(channelId) ?? 0);
    if (version.get(channelId) !== v) return; // 그 뒤에 시작한 세기가 있다
    if (counts.get(channelId) === n) return;
    counts.set(channelId, n);
    notify();
  } catch {
    // 위와 같다
  }
}
