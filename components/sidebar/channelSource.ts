// ② 채널 목록 데이터 (Supabase). 화면은 이 파일의 함수만 부른다.
// 권한은 DB 가 지킨다 (TECH_SPEC 5절, supabase/migrations/20260929100000_db_v1.sql):
//   channels 조회 — 공개 채널은 모두, 비공개는 멤버(와 관리자)만
//   channels 만들기 — 로그인 사용자. 만든 사람은 트리거(channels_add_creator)가 멤버로 넣는다
//   memberships 가입 — 공개 채널만 본인이. 비공개 채널 추가는 관리자만
//   memberships 조회 — 같은 채널 멤버끼리만 → 가입 안 한 공개 채널의 멤버 수는 알 수 없다 (null)

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ChannelSummary, ChannelType } from "@/lib/types/channel";
import { getSupabase } from "@/lib/supabase";

/** DB 의 channels_name 제약과 같다 */
export const NAME_MAX = 40;

/** #일반. 모든 사람이 멤버다 (20260929100100_step1_compat.sql 에서 고정, WorkspaceContext 기본 채널과 같다) */
export const GENERAL_ID = "00000000-0000-0000-0000-000000000001";

type Row = {
  id: string;
  name: string | null;
  type: ChannelType;
  created_by: string | null;
  created_at: string;
};

const COLUMNS = "id, name, type, created_by, created_at";

const listeners = new Set<() => void>();
let live: RealtimeChannel | null = null;

/** 목록이 바뀌면 알려 준다 (왼쪽 칸과 헤더의 채널 목록이 함께 갱신되도록).
 *  남이 나를 채널에 넣으면(관리자 추가) 실시간으로도 알린다. 구독은 쓰는 곳이 여럿이어도 하나만 연다 */
export function subscribeChannels(fn: () => void): () => void {
  listeners.add(fn);
  if (!live) void startLive();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && live) {
      void getSupabase().removeChannel(live);
      live = null;
    }
  };
}
export const notifyChannelsChanged = () => listeners.forEach((fn) => fn());

async function startLive() {
  const supabase = getSupabase();
  const me = await myId().catch(() => null);
  if (!me || live || listeners.size === 0) return;
  live = supabase
    .channel(`memberships:${me}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "memberships", filter: `user_id=eq.${me}` },
      notifyChannelsChanged,
    )
    .subscribe();
}

/** 저장할 이름: 한글 조합 방식 통일(NFC), 보이지 않는 글자 제거, 공백 정리 */
export const cleanName = (raw: string) =>
  raw
    .normalize("NFC")
    .replace(/[​-‍⁠﻿]/g, "")
    .trim()
    .replace(/\s+/g, " ");

/** 이름 비교용 (대소문자 무시) */
const norm = (name: string | null) => cleanName(name ?? "").toLowerCase();

/** 채널 이름 검사. 문제가 없으면 null. DB 는 char_length 로 재므로 코드 포인트 수로 센다 */
export function channelNameProblem(raw: string): string | null {
  const name = cleanName(raw);
  if (!name) return "채널 이름을 적어 주세요";
  if ([...name].length > NAME_MAX) return `채널 이름은 ${NAME_MAX}자까지입니다`;
  if (name.startsWith("#")) return "# 은 빼고 적어 주세요";
  return null;
}

async function myId(): Promise<string> {
  // 쿠키의 세션에서 읽는다 (네트워크 없음). 권한은 어차피 DB 가 토큰으로 다시 확인한다
  const { data } = await getSupabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("로그인이 필요합니다");
  return id;
}

function friendly(error: { code?: string; message: string }): Error {
  if (error.code === "42501") return new Error("권한이 없습니다");
  if (error.code === "23514") return new Error("채널 이름을 확인해 주세요 (1~40자)");
  return new Error(error.message);
}

/** 채널별 멤버 수. RLS 때문에 내가 멤버인 채널만 셀 수 있다 */
async function memberCounts(channelIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (channelIds.length === 0) return counts;
  const { data, error } = await getSupabase()
    .from("memberships")
    .select("channel_id")
    .in("channel_id", channelIds);
  if (error) throw friendly(error);
  for (const m of data ?? []) counts.set(m.channel_id, (counts.get(m.channel_id) ?? 0) + 1);
  return counts;
}

async function myChannelIds(me: string): Promise<Set<string>> {
  const { data, error } = await getSupabase()
    .from("memberships")
    .select("channel_id")
    .eq("user_id", me);
  if (error) throw friendly(error);
  return new Set((data ?? []).map((m) => m.channel_id));
}

function summarize(c: Row, joined: boolean, count: number | undefined): ChannelSummary {
  return {
    id: c.id,
    name: c.name ?? "",
    type: c.type,
    created_by: c.created_by,
    created_at: c.created_at,
    member_count: joined ? (count ?? null) : null,
    joined,
  };
}

const byName = (a: Row, b: Row) => (a.name ?? "").localeCompare(b.name ?? "", "ko");

// ── 화면이 부르는 함수 ──────────────────────────────────────

/** 내가 가입한 채널 (DM 제외). #일반을 맨 위에, 나머지는 이름순 */
export async function listMyChannels(): Promise<ChannelSummary[]> {
  const me = await myId();
  const ids = [...(await myChannelIds(me))];
  if (ids.length === 0) return [];
  const { data, error } = await getSupabase()
    .from("channels")
    .select(COLUMNS)
    .in("id", ids)
    .neq("type", "dm");
  if (error) throw friendly(error);
  const rows = (data ?? []) as Row[];
  const counts = await memberCounts(rows.map((r) => r.id));
  return rows
    .sort((a, b) => (a.id === GENERAL_ID ? -1 : b.id === GENERAL_ID ? 1 : byName(a, b)))
    .map((r) => summarize(r, true, counts.get(r.id)));
}

/** 공개 채널 (가입 안 한 것 포함). 이름 일부로 거른다 */
export async function listPublicChannels(query = ""): Promise<ChannelSummary[]> {
  const me = await myId();
  let request = getSupabase().from("channels").select(COLUMNS).eq("type", "public").limit(200);
  const q = cleanName(query);
  // ilike 의 % _ \ 는 글자 그대로 찾도록 막는다
  if (q) request = request.ilike("name", `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  const { data, error } = await request;
  if (error) throw friendly(error);
  const rows = ((data ?? []) as Row[]).sort(byName);
  const mine = await myChannelIds(me);
  const counts = await memberCounts(rows.filter((r) => mine.has(r.id)).map((r) => r.id));
  return rows.map((r) => summarize(r, mine.has(r.id), counts.get(r.id)));
}

/** 만든 사람은 트리거가 바로 멤버로 넣는다. 내가 볼 수 있는 채널 중 같은 이름이 있으면 거부한다
 *  (DB 에는 이름 유일 제약이 없다. 안 보이는 비공개 채널은 RLS 가 가려서 비교 대상이 아니다) */
export async function createChannel(input: {
  name: string;
  type: "public" | "private";
}): Promise<ChannelSummary> {
  const problem = channelNameProblem(input.name);
  if (problem) throw new Error(problem);
  const name = cleanName(input.name);
  const supabase = getSupabase();

  const { data: same, error: findError } = await supabase
    .from("channels")
    .select("id, name")
    .neq("type", "dm")
    .ilike("name", name.replace(/[\\%_]/g, (ch) => `\\${ch}`));
  if (findError) throw friendly(findError);
  if ((same ?? []).some((c) => norm(c.name) === norm(name))) {
    throw new Error("같은 이름의 채널이 이미 있습니다");
  }

  const { data, error } = await supabase
    .from("channels")
    .insert({ name, type: input.type })
    .select(COLUMNS)
    .single();
  if (error) throw friendly(error);
  notifyChannelsChanged();
  return summarize(data as Row, true, 1);
}

/** 공개 채널만 스스로 가입할 수 있다 (RLS). 이미 멤버면 그대로 둔다 */
export async function joinChannel(channelId: string): Promise<ChannelSummary> {
  const me = await myId();
  const supabase = getSupabase();
  const { error } = await supabase
    .from("memberships")
    .insert({ channel_id: channelId, user_id: me });
  if (error && error.code !== "23505") throw friendly(error); // 23505 = 이미 멤버
  const { data, error: readError } = await supabase
    .from("channels")
    .select(COLUMNS)
    .eq("id", channelId)
    .single();
  if (readError) throw friendly(readError);
  const counts = await memberCounts([channelId]);
  notifyChannelsChanged();
  return summarize(data as Row, true, counts.get(channelId));
}
