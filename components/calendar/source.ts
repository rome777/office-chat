// ② 캘린더 데이터 (Supabase). 화면은 이 파일의 함수만 부른다.
// 권한은 DB 가 지킨다 (TECH_SPEC 5절, supabase/migrations/20260929100000_db_v1.sql · 20260930230000_schedule_v2.sql):
//   events 조회 — 만든 사람과 참석자만. 수정·취소 — 만든 사람만. 삭제 없음 (canceled_at 으로 취소)
//   event_attendees — 그 일정 참여자가 조회, 추가·삭제는 만든 사람, 본인은 response·remind_minutes 만
//   일정 만들기 — create_event() 한 번에 일정 + 참석자 (만든 사람은 accepted)
//   분류(category) — 저장할 때 DB 트리거가 정한다. 화면은 읽기만 한다
//   팀원 일정 — list_team_events() 로 같은 부서 팀원 일정을 공개 범위에 맞게 가린 칸만 (회의·나만 보기는 없음)
//   회의실 예약 현황 — room_busy() 로 시각만 (남의 회의 제목·참석자는 주지 않는다)
//   회의실 겹침 — events_no_double_booking 제약이 막는다 (23P01). 두 사람이 동시에 눌러도 하나만 성공

import type {
  AttendeeResponse,
  CalendarEvent,
  EventAttendee,
  EventKind,
  Room,
  TeamEvent,
  Visibility,
} from "@/lib/types/calendar";
import { getSupabase } from "@/lib/supabase";

export type EventWithAttendees = CalendarEvent & { attendees: EventAttendee[] };

export type EventInput = {
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  room_id: string | null;
  /** 만든 사람을 뺀 참석자 */
  attendee_ids: string[];
  kind?: EventKind;
  subtype?: string | null;
  all_day?: boolean;
  location?: string | null;
  /** 회의는 무시된다 (참석자에게만) */
  visibility?: Visibility;
  channel_id?: string | null;
  /** 만든 사람(나)의 시작 전 알림. 고치기에서는 setMyReminders 로 따로 바꾼다 */
  remind_minutes?: number[];
};

export type BusySlot = { starts_at: string; ends_at: string };

/** 같은 회의실이 겹치는 시간에 이미 잡혀 있다 (DB 의 exclude 제약 오류 23P01) */
export class RoomConflictError extends Error {
  constructor() {
    super("이미 예약된 시간입니다");
    this.name = "RoomConflictError";
  }
}

/** 권한 없음 (RLS 거부, 또는 RLS 에 가려 0행이 바뀐 경우) */
export class ForbiddenError extends Error {
  constructor(message = "권한이 없습니다") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** DB 의 events 제약과 같다 */
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 2000;
export const LOCATION_MAX = 100;

const EVENT_COLUMNS =
  "id, title, description, starts_at, ends_at, room_id, created_by, created_at, updated_at, canceled_at, " +
  "kind, subtype, all_day, location, visibility, channel_id, category, team_unit_id";
const WITH_ATTENDEES = `${EVENT_COLUMNS}, attendees:event_attendees(event_id, user_id, response, responded_at, remind_minutes)`;

// ── 공통 ────────────────────────────────────────────────────

/** 로그인한 나. 쿠키의 세션에서 읽는다 (네트워크 없음). 권한은 DB 가 토큰으로 다시 확인한다 */
export async function getMyId(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new ForbiddenError("로그인이 필요합니다");
  return id;
}

type DbError = { code?: string; message: string };

function friendly(error: DbError): Error {
  if (error.code === "23P01") return new RoomConflictError();
  if (error.code === "42501") return new ForbiddenError(error.message.includes("채널") ? error.message : undefined);
  if (error.code === "23514") {
    return new Error(`제목(1~${TITLE_MAX}자)·설명(${DESCRIPTION_MAX}자까지)·장소(${LOCATION_MAX}자까지)·시각을 확인해 주세요`);
  }
  if (error.code === "23503") return new Error("없는 회의실이나 사람이 들어 있습니다");
  return new Error(error.message);
}

function validate(input: EventInput) {
  const title = input.title.trim();
  if (!title || [...title].length > TITLE_MAX) throw new Error(`제목은 1~${TITLE_MAX}자로 적어 주세요`);
  if ((input.description?.length ?? 0) > DESCRIPTION_MAX) {
    throw new Error(`설명은 ${DESCRIPTION_MAX}자까지입니다`);
  }
  if ((input.location?.trim().length ?? 0) > LOCATION_MAX) throw new Error(`장소는 ${LOCATION_MAX}자까지입니다`);
  if (!(new Date(input.ends_at).getTime() > new Date(input.starts_at).getTime())) {
    throw new Error("끝나는 시각이 시작보다 늦어야 합니다");
  }
}

/** uuid 가 아니면 DB 가 22P02 오류를 낸다. 주소의 ?e= 가 잘못돼도 "찾을 수 없음"으로 보이게 미리 거른다 */
const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** 새 칸. 회의의 공개 범위는 쓰지 않으므로 팀에 공개로 둔다 */
function extraColumns(input: EventInput) {
  const kind = input.kind ?? "meeting";
  return {
    kind,
    subtype: input.subtype ?? null,
    all_day: input.all_day ?? false,
    location: input.location?.trim() || null,
    visibility: kind === "meeting" ? "public" : (input.visibility ?? (kind === "personal" ? "time_only" : "public")),
    channel_id: input.channel_id ?? null,
  };
}

// ── 화면이 부르는 함수 ──────────────────────────────────────

export async function listRooms(): Promise<Room[]> {
  const { data, error } = await getSupabase()
    .from("rooms")
    .select("id, name, capacity, location")
    .order("name");
  if (error) throw friendly(error);
  return data ?? [];
}

/** 내가 만들었거나 초대받은 일정 중 [from, to) 와 겹치는 것 (RLS 가 남의 일정을 가린다) */
export async function listMyEvents(from: Date, to: Date): Promise<EventWithAttendees[]> {
  const { data, error } = await getSupabase()
    .from("events")
    .select(WITH_ATTENDEES)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString())
    .order("starts_at");
  if (error) throw friendly(error);
  return (data ?? []) as EventWithAttendees[];
}

/** 같은 부서 팀원의 일정 (공개 범위에 맞게 가린 칸만). DB 는 한 번에 62일까지라 60일씩 나눠 부르고 겹친 것은 하나로 */
export async function listTeamEvents(from: Date, to: Date): Promise<TeamEvent[]> {
  const STEP = 60 * 24 * 60 * 60 * 1000;
  const parts: Promise<TeamEvent[]>[] = [];
  for (let a = from.getTime(); a < to.getTime(); a += STEP) {
    const b = Math.min(a + STEP, to.getTime());
    parts.push(
      Promise.resolve(
        getSupabase().rpc("list_team_events", { p_from: new Date(a).toISOString(), p_to: new Date(b).toISOString() }),
      ).then(({ data, error }) => {
        if (error) throw friendly(error);
        return (data ?? []) as TeamEvent[];
      }),
    );
  }
  const seen = new Set<string>();
  return (await Promise.all(parts)).flat().filter((t) => !seen.has(t.event_id) && (seen.add(t.event_id), true));
}

/** 참석자가 아니면 null (남의 일정은 id 를 알아도 RLS 가 0행으로 돌려준다) */
export async function getEvent(id: string): Promise<EventWithAttendees | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await getSupabase()
    .from("events")
    .select(WITH_ATTENDEES)
    .eq("id", id)
    .maybeSingle();
  if (error) throw friendly(error);
  return (data as EventWithAttendees | null) ?? null;
}

/** 분류 이름: 팀이면 조직 이름, 프로젝트면 채널 이름. 조직은 누구나, 채널은 멤버만 읽힌다 (못 읽으면 빠진다) */
export async function getCategoryNames(
  unitIds: string[],
  channelIds: string[],
): Promise<{ units: Map<string, string>; channels: Map<string, string> }> {
  const supabase = getSupabase();
  const [u, c] = await Promise.all([
    unitIds.length ? supabase.from("org_units").select("id, name").in("id", unitIds) : Promise.resolve({ data: [] }),
    channelIds.length ? supabase.from("channels").select("id, name").in("id", channelIds) : Promise.resolve({ data: [] }),
  ]);
  return {
    units: new Map((u.data ?? []).map((x: { id: string; name: string }) => [x.id, x.name])),
    channels: new Map((c.data ?? []).map((x: { id: string; name: string | null }) => [x.id, x.name ?? ""])),
  };
}

/** 부서 채널 id 들 (org_units 는 로그인 사용자 누구나 읽는다). 일정의 "관련 채널"에 부서 채널이라고 붙인다 */
export async function listOrgChannelIds(): Promise<Set<string>> {
  const { data, error } = await getSupabase().from("org_units").select("channel_id");
  if (error) throw friendly(error);
  return new Set((data ?? []).map((r: { channel_id: string }) => r.channel_id));
}

/** 회의실의 예약된 시간대만 돌려준다 (제목·참석자는 주지 않는다) */
export async function roomBusy(roomId: string, from: Date, to: Date): Promise<BusySlot[]> {
  const { data, error } = await getSupabase().rpc("room_busy", {
    p_room_id: roomId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw friendly(error);
  return (data ?? []) as BusySlot[];
}

export async function createEvent(input: EventInput): Promise<EventWithAttendees> {
  validate(input);
  const extra = extraColumns(input);
  const { data: id, error } = await getSupabase().rpc("create_event", {
    p_title: input.title.trim(),
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
    p_room_id: input.room_id,
    p_attendee_ids: [...new Set(input.attendee_ids)],
    p_description: input.description?.trim() || null,
    p_kind: extra.kind,
    p_subtype: extra.subtype,
    p_all_day: extra.all_day,
    p_location: extra.location,
    p_visibility: extra.visibility,
    p_channel_id: extra.channel_id,
    p_remind_minutes: input.remind_minutes ?? [10],
  });
  if (error) throw friendly(error);
  const created = await getEvent(id as string);
  if (!created) throw new Error("일정을 만들었지만 다시 읽지 못했습니다. 새로고침해 주세요");
  return created;
}

/** 만든 사람만. 남아 있는 참석자의 응답은 그대로 두고, 새 참석자는 "응답 전"으로 넣는다.
 *  일정 내용과 참석자를 따로 저장한다 (DB 에 한 번에 고치는 함수가 없다) — 참석자 저장이 실패하면 알린다.
 *  baseAttendeeIds: 폼을 열 때의 참석자. 주면 "폼에서 뺀 사람"만 지운다 (그 사이 다른 탭에서 넣은 사람은 둔다) */
export async function updateEvent(
  id: string,
  input: EventInput,
  baseAttendeeIds?: string[],
): Promise<EventWithAttendees> {
  const current = await getEvent(id);
  if (!current) throw new ForbiddenError("일정을 찾을 수 없습니다");
  const me = await getMyId();
  if (current.created_by !== me) throw new ForbiddenError("만든 사람만 고칠 수 있습니다");
  if (current.canceled_at) throw new ForbiddenError("취소된 일정은 고칠 수 없습니다");
  validate(input);

  const supabase = getSupabase();
  // 예전 폼(회의실 예약)은 유형 칸을 주지 않는다 → 원래 값을 둔다
  const extra = input.kind
    ? extraColumns(input)
    : {
        kind: current.kind,
        subtype: current.subtype,
        all_day: current.all_day,
        location: current.location,
        visibility: current.visibility,
        channel_id: current.channel_id,
      };
  const { data: updated, error } = await supabase
    .from("events")
    .update({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      room_id: input.room_id,
      ...extra,
    })
    .eq("id", id)
    .is("canceled_at", null) // 폼을 연 사이 취소됐으면 고치지 않는다
    .select("id");
  if (error) throw friendly(error);
  if (!updated?.length) throw new ForbiddenError("일정이 취소됐거나 고칠 권한이 없습니다");

  const keep = new Set([me, ...input.attendee_ids]);
  const had = new Set(current.attendees.map((a) => a.user_id));
  const base = new Set(baseAttendeeIds ?? had);
  const remove = [...had].filter((u) => base.has(u) && !keep.has(u));
  const add = [...keep].filter((u) => !had.has(u));
  if (remove.length) {
    const { error: e } = await supabase
      .from("event_attendees")
      .delete()
      .eq("event_id", id)
      .in("user_id", remove);
    if (e) throw new Error(`일정은 고쳤지만 참석자를 빼지 못했습니다: ${friendly(e).message}`);
  }
  if (add.length) {
    // 다른 탭에서 같은 사람을 동시에 넣어도 오류 없이 한 행만 남게
    const { error: e } = await supabase
      .from("event_attendees")
      // 종일 일정은 알림 없이 (0시 10분 전 = 전날 23:50 이 되므로). 모든 행에 같은 칸을 준다
      .upsert(add.map((user_id) => ({ event_id: id, user_id, remind_minutes: user_id === me ? (input.remind_minutes ?? [10]) : extra.all_day ? [] : [10] })), {
        onConflict: "event_id,user_id",
        ignoreDuplicates: true,
      });
    if (e) throw new Error(`일정은 고쳤지만 참석자를 넣지 못했습니다: ${friendly(e).message}`);
  }
  if (input.remind_minutes) await setMyReminders(id, input.remind_minutes);

  const fresh = await getEvent(id);
  if (!fresh) throw new Error("일정을 고쳤지만 다시 읽지 못했습니다. 새로고침해 주세요");
  return fresh;
}

/** 만든 사람만. 지우지 않고 canceled_at 을 채운다 (회의실 자리는 비워진다) */
export async function cancelEvent(id: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from("events")
    .update({ canceled_at: new Date().toISOString() })
    .eq("id", id)
    .is("canceled_at", null)
    .select("id");
  if (error) throw friendly(error);
  if (!data?.length) {
    const still = await getEvent(id);
    if (!still) throw new ForbiddenError("일정을 찾을 수 없습니다");
    if (!still.canceled_at) throw new ForbiddenError("만든 사람만 취소할 수 있습니다");
    // 이미 취소돼 있으면 그대로 둔다
  }
}

/** 본인 응답만 바꾼다 (RLS). responded_at 은 DB 트리거가 채운다 */
export async function respond(id: string, response: AttendeeResponse): Promise<void> {
  const me = await getMyId();
  const { data, error } = await getSupabase()
    .from("event_attendees")
    .update({ response })
    .eq("event_id", id)
    .eq("user_id", me)
    .select("event_id");
  if (error) throw friendly(error);
  if (!data?.length) throw new ForbiddenError("초대받은 일정이 아닙니다");
}

/** 내 시작 전 알림 시각 (참석자 누구나 자기 것만) */
export async function setMyReminders(id: string, minutes: number[]): Promise<void> {
  const me = await getMyId();
  const { data, error } = await getSupabase()
    .from("event_attendees")
    .update({ remind_minutes: [...new Set(minutes)].sort((a, b) => a - b) })
    .eq("event_id", id)
    .eq("user_id", me)
    .select("event_id");
  if (error) throw friendly(error);
  if (!data?.length) throw new ForbiddenError("참석자만 알림을 바꿀 수 있습니다");
}
