// ② 채널 목록 데이터 (Supabase). 화면은 이 파일의 함수만 부른다.
// 권한은 DB 가 지킨다 (TECH_SPEC 5절, supabase/migrations/20260929100000_db_v1.sql):
//   channels 조회 — 공개 채널은 모두, 비공개는 멤버(와 관리자)만
//   channels 만들기 — 로그인 사용자. 만든 사람은 트리거(channels_add_creator)가 멤버로 넣는다
//   memberships 가입 — 공개 채널만 본인이. 비공개 채널 추가는 관리자만
//   memberships 조회 — 같은 채널 멤버끼리만 → 가입 안 한 공개 채널의 멤버 수는 알 수 없다 (null)

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ChannelSummary, ChannelType, DmSummary } from "@/lib/types/channel";
import { getSupabase } from "@/lib/supabase";
import { getPeople } from "@/components/people/directory";

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

// ── 목록 갱신 알림 ──────────────────────────────────────────

const listeners = new Set<() => void>();
let live: RealtimeChannel | null = null;
let liveSeq = 0;

/** 목록이 바뀌면 알려 준다 (왼쪽 칸과 헤더의 채널 목록이 함께 갱신되도록).
 *  남이 나를 채널에 넣거나 빼면(관리자) 실시간으로도 알린다. 구독은 쓰는 곳이 여럿이어도 하나만 연다 */
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
  const me = await myId().catch(() => null);
  if (!me || live || listeners.size === 0) return;
  live = getSupabase()
    // 떠나는 중인 이전 구독과 이름이 겹치면 새 구독이 붙지 않으므로 매번 새 이름을 쓴다
    .channel(`memberships:${me}:${++liveSeq}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "memberships", filter: `user_id=eq.${me}` },
      notifyChannelsChanged,
    )
    // 구독이 붙기 전(또는 끊겼다 다시 붙는 동안) 생긴 변화는 이벤트로 오지 않으므로, 붙을 때마다 다시 불러온다
    .subscribe((status) => {
      if (status === "SUBSCRIBED") notifyChannelsChanged();
    });
}

// ── 이름 ────────────────────────────────────────────────────

const INVISIBLE = new RegExp("[\\u200B-\\u200D\\u2060\\uFEFF]", "g");

/** 저장할 이름: 한글 조합 방식 통일(NFC), 보이지 않는 글자 제거, 공백 정리 */
export const cleanName = (raw: string) =>
  raw.normalize("NFC").replace(INVISIBLE, "").trim().replace(/\s+/g, " ");

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

// ── 공통 ────────────────────────────────────────────────────

/** 로그인한 나 (DM 상대 고르기에서 나를 빼는 데도 쓴다) */
export const getMyUserId = () => myId();

async function myId(): Promise<string> {
  // 쿠키의 세션에서 읽는다 (네트워크 없음). 권한은 어차피 DB 가 토큰으로 다시 확인한다
  const { data } = await getSupabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("로그인이 필요합니다");
  return id;
}

function friendly(error: { code?: string; message: string }): Error {
  if (error.code === "42501") return new Error("권한이 없습니다");
  if (error.code === "23514") return new Error(`채널 이름을 확인해 주세요 (1~${NAME_MAX}자)`);
  return new Error(error.message);
}

/** 채널별 멤버 수. RLS 때문에 내가 멤버인 채널만 셀 수 있다.
 *  행을 받아 세지 않고 채널마다 개수만 묻는다 (한 번에 받는 행 수 상한 1000 에 걸리지 않게) */
async function memberCounts(channelIds: string[]): Promise<Map<string, number>> {
  const supabase = getSupabase();
  const results = await Promise.all(
    channelIds.map((id) =>
      supabase.from("memberships").select("*", { count: "exact", head: true }).eq("channel_id", id),
    ),
  );
  const counts = new Map<string, number>();
  results.forEach(({ count, error }, i) => {
    if (error) throw friendly(error);
    if (count !== null) counts.set(channelIds[i], count);
  });
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
  // 내 멤버십이 있는 채널만 (inner join) — 채널 id 를 주소에 늘어놓지 않는다
  const { data, error } = await getSupabase()
    .from("channels")
    .select(`${COLUMNS}, memberships!inner(user_id)`)
    .eq("memberships.user_id", me)
    .neq("type", "dm");
  if (error) throw friendly(error);
  const rows = (data ?? []) as Row[];
  const counts = await memberCounts(rows.map((r) => r.id));
  return rows
    .sort((a, b) => (a.id === GENERAL_ID ? -1 : b.id === GENERAL_ID ? 1 : byName(a, b)))
    .map((r) => summarize(r, true, counts.get(r.id)));
}

/** 공개 채널 (가입 안 한 것 포함). 이름 일부로 거른다.
 *  PostgREST 의 like 는 * 도 와일드카드로 보고 막을 방법이 없어서, 이름 거르기는 받아 온 뒤 여기서 한다 */
export async function listPublicChannels(query = ""): Promise<ChannelSummary[]> {
  const me = await myId();
  const { data, error } = await getSupabase()
    .from("channels")
    .select(COLUMNS)
    .eq("type", "public")
    .limit(1000);
  if (error) throw friendly(error);
  const q = norm(query);
  const rows = ((data ?? []) as Row[]).filter((r) => !q || norm(r.name).includes(q)).sort(byName);
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

  // 내가 볼 수 있는 채널 이름을 받아 여기서 비교한다 (like 는 * 를 와일드카드로 본다)
  const { data: visible, error: findError } = await supabase
    .from("channels")
    .select("name")
    .neq("type", "dm")
    .limit(1000);
  if (findError) throw friendly(findError);
  if ((visible ?? []).some((c) => norm(c.name) === norm(name))) {
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
  notifyChannelsChanged(); // 가입은 됐다. 아래 읽기가 실패해도 목록은 갱신한다
  const { data, error: readError } = await supabase
    .from("channels")
    .select(COLUMNS)
    .eq("id", channelId)
    .single();
  if (readError) throw friendly(readError);
  const counts = await memberCounts([channelId]);
  return summarize(data as Row, true, counts.get(channelId));
}

// ── DM ──────────────────────────────────────────────────────
// DM 은 멤버 2명인 채널이다 (type = 'dm'). 만들기는 create_dm(other_user_id) 로만 한다 —
// 같은 두 사람이면 dm_key 가 같아서 몇 번을 불러도 대화방은 하나다. 관리자도 남의 DM 은 못 본다 (RLS).
// 남이 나에게 DM 을 시작하면 내 memberships 가 생기므로, 위의 실시간 구독이 목록을 다시 불러온다.

/** 내 DM 목록. 상대 이름순.
 *  왼쪽 칸과 헤더 목록이 같은 이벤트로 동시에 부르므로, 진행 중인 요청이 있으면 그 결과를 같이 쓴다 */
let dmsInFlight: Promise<DmSummary[]> | null = null;
export function listMyDms(): Promise<DmSummary[]> {
  dmsInFlight ??= fetchMyDms().finally(() => {
    dmsInFlight = null;
  });
  return dmsInFlight;
}

async function fetchMyDms(): Promise<DmSummary[]> {
  const me = await myId();
  // mine: 내 멤버십이 있는 DM 만 (inner join), all: 그 DM 의 두 멤버 — 같은 채널 멤버라서 상대 행도 읽힌다
  const { data, error } = await getSupabase()
    .from("channels")
    .select("id, mine:memberships!inner(user_id), all:memberships(user_id)")
    .eq("mine.user_id", me)
    .eq("type", "dm");
  if (error) throw friendly(error);
  const pairs = ((data ?? []) as { id: string; all: { user_id: string }[] }[])
    .map((d) => ({ id: d.id, other: d.all.find((m) => m.user_id !== me)?.user_id }))
    .filter((d): d is { id: string; other: string } => Boolean(d.other)); // 상대가 탈퇴한 DM 은 뺀다
  const people = new Map((await getPeople(pairs.map((d) => d.other))).map((p) => [p.id, p]));
  return pairs
    .map((d) => ({ id: d.id, other: people.get(d.other)! })) // getPeople 은 모르는 id 도 자리표시로 돌려준다
    .sort((a, b) => a.other.display_name.localeCompare(b.other.display_name, "ko"));
}

/** 상대와의 DM 을 열거나(이미 있으면 그 방) 새로 만든다. 채널 id 를 돌려준다 */
export async function startDm(otherUserId: string): Promise<string> {
  const { data, error } = await getSupabase().rpc("create_dm", { other_user_id: otherUserId });
  if (error) {
    if (error.code === "22023") throw new Error("DM 상대가 올바르지 않습니다");
    throw friendly(error);
  }
  notifyChannelsChanged();
  return data as string;
}
