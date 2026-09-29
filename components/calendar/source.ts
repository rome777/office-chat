// ② 캘린더 데이터 (Supabase). 화면은 이 파일의 함수만 부른다.
// 권한은 DB 가 지킨다 (TECH_SPEC 5절, supabase/migrations/20260929100000_db_v1.sql):
//   events 조회 — 만든 사람과 참석자만. 수정·취소 — 만든 사람만. 삭제 없음 (canceled_at 으로 취소)
//   event_attendees — 그 회의 참여자가 조회, 추가·삭제는 만든 사람, 본인은 response 만
//   회의 만들기 — create_event() 한 번에 회의 + 참석자 (만든 사람은 accepted)
//   회의실 예약 현황 — room_busy() 로 시각만 (남의 회의 제목·참석자는 주지 않는다)
//   회의실 겹침 — events_no_double_booking 제약이 막는다 (23P01). 두 사람이 동시에 눌러도 하나만 성공

import type { AttendeeResponse, CalendarEvent, EventAttendee, Room } from "@/lib/types/calendar";
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

const EVENT_COLUMNS =
  "id, title, description, starts_at, ends_at, room_id, created_by, created_at, updated_at, canceled_at";
const WITH_ATTENDEES = `${EVENT_COLUMNS}, attendees:event_attendees(event_id, user_id, response, responded_at)`;

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
  if (error.code === "42501") return new ForbiddenError();
  if (error.code === "23514") {
    return new Error(`제목(1~${TITLE_MAX}자)·설명(${DESCRIPTION_MAX}자까지)·시각을 확인해 주세요`);
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
  if (!(new Date(input.ends_at).getTime() > new Date(input.starts_at).getTime())) {
    throw new Error("끝나는 시각이 시작보다 늦어야 합니다");
  }
}

/** uuid 가 아니면 DB 가 22P02 오류를 낸다. 주소의 ?e= 가 잘못돼도 "찾을 수 없음"으로 보이게 미리 거른다 */
const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ── 화면이 부르는 함수 ──────────────────────────────────────

export async function listRooms(): Promise<Room[]> {
  const { data, error } = await getSupabase()
    .from("rooms")
    .select("id, name, capacity, location")
    .order("name");
  if (error) throw friendly(error);
  return data ?? [];
}

/** 내가 만들었거나 초대받은 회의 중 [from, to) 와 겹치는 것 (RLS 가 남의 회의를 가린다) */
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

/** 참석자가 아니면 null (남의 회의는 id 를 알아도 RLS 가 0행으로 돌려준다) */
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
  const { data: id, error } = await getSupabase().rpc("create_event", {
    p_title: input.title.trim(),
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
    p_room_id: input.room_id,
    p_attendee_ids: [...new Set(input.attendee_ids)],
    p_description: input.description?.trim() || null,
  });
  if (error) throw friendly(error);
  const created = await getEvent(id as string);
  if (!created) throw new Error("회의를 만들었지만 다시 읽지 못했습니다. 새로고침해 주세요");
  return created;
}

/** 만든 사람만. 남아 있는 참석자의 응답은 그대로 두고, 새 참석자는 "응답 전"으로 넣는다.
 *  회의 내용과 참석자를 따로 저장한다 (DB 에 한 번에 고치는 함수가 없다) — 참석자 저장이 실패하면 알린다.
 *  baseAttendeeIds: 폼을 열 때의 참석자. 주면 "폼에서 뺀 사람"만 지운다 (그 사이 다른 탭에서 넣은 사람은 둔다) */
export async function updateEvent(
  id: string,
  input: EventInput,
  baseAttendeeIds?: string[],
): Promise<EventWithAttendees> {
  const current = await getEvent(id);
  if (!current) throw new ForbiddenError("회의를 찾을 수 없습니다");
  const me = await getMyId();
  if (current.created_by !== me) throw new ForbiddenError("만든 사람만 고칠 수 있습니다");
  if (current.canceled_at) throw new ForbiddenError("취소된 회의는 고칠 수 없습니다");
  validate(input);

  const supabase = getSupabase();
  const { data: updated, error } = await supabase
    .from("events")
    .update({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      room_id: input.room_id,
    })
    .eq("id", id)
    .is("canceled_at", null) // 폼을 연 사이 취소됐으면 고치지 않는다
    .select("id");
  if (error) throw friendly(error);
  if (!updated?.length) throw new ForbiddenError("회의가 취소됐거나 고칠 권한이 없습니다");

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
    if (e) throw new Error(`회의는 고쳤지만 참석자를 빼지 못했습니다: ${friendly(e).message}`);
  }
  if (add.length) {
    // 다른 탭에서 같은 사람을 동시에 넣어도 오류 없이 한 행만 남게
    const { error: e } = await supabase
      .from("event_attendees")
      .upsert(add.map((user_id) => ({ event_id: id, user_id })), {
        onConflict: "event_id,user_id",
        ignoreDuplicates: true,
      });
    if (e) throw new Error(`회의는 고쳤지만 참석자를 넣지 못했습니다: ${friendly(e).message}`);
  }

  const fresh = await getEvent(id);
  if (!fresh) throw new Error("회의를 고쳤지만 다시 읽지 못했습니다. 새로고침해 주세요");
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
    if (!still) throw new ForbiddenError("회의를 찾을 수 없습니다");
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
  if (!data?.length) throw new ForbiddenError("초대받은 회의가 아닙니다");
}
