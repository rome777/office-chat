// ② 캘린더 데이터. 화면은 이 파일의 함수만 부른다.
// 지금은 브라우저 메모리의 가짜 데이터다 (새로고침하면 처음 상태로 돌아간다).
// WU-02 로 테이블·함수가 생기면 각 함수 안만 Supabase 호출로 바꾼다:
//   listMyEvents·getEvent → events + event_attendees 조회 (RLS 가 참석자만 보여 준다)
//   roomBusy → room_busy(room_id, from, to)   createEvent → create_event(...)
//   updateEvent·cancelEvent → events update   respond → event_attendees update
// 가짜 데이터도 DB 와 같은 규칙(참석자만 보기, 회의실 겹침 거부, 만든 사람만 수정)을 지킨다.
// 그래야 화면의 오류 처리를 지금 시험할 수 있다.

import type { AttendeeResponse, CalendarEvent, EventAttendee, Room } from "@/lib/types/calendar";
import { DEMO_ME_ID } from "@/components/people/directory";
import { addDays, fromKstInput, kstDateKey, startOfKstWeek, toMs } from "./time";

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

/** 같은 회의실이 겹치는 시간에 이미 잡혀 있다 (DB 의 exclude 제약 오류에 해당) */
export class RoomConflictError extends Error {
  constructor() {
    super("이미 예약된 시간입니다");
    this.name = "RoomConflictError";
  }
}

/** 권한 없음 (RLS 거부에 해당) */
export class ForbiddenError extends Error {
  constructor(message = "권한이 없습니다") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export const TITLE_MAX = 100;

// ── 가짜 데이터 ─────────────────────────────────────────────

let me = DEMO_ME_ID;

/** 가짜 데이터에서 "보는 사람"을 바꾼다 (A·B·C 권한 차이를 화면에서 시험하려고). 로그인이 붙으면 없앤다 */
export function setDemoViewer(userId: string) {
  me = userId;
}
export const getDemoViewer = () => me;

const rooms: Room[] = [
  { id: "room-1", name: "회의실 1 (소)", capacity: 4, location: "3층" },
  { id: "room-2", name: "회의실 2 (중)", capacity: 8, location: "3층" },
  { id: "room-3", name: "회의실 3 (대)", capacity: 16, location: "5층" },
];

const events: CalendarEvent[] = [];
const attendees: EventAttendee[] = [];

function seed() {
  const monday = kstDateKey(startOfKstWeek(new Date()));
  const day = (n: number) => kstDateKey(addDays(new Date(`${monday}T00:00:00+09:00`), n));
  const at = (n: number, time: string) => fromKstInput(day(n), time).toISOString();
  const now = new Date().toISOString();
  const add = (
    id: string,
    title: string,
    dayIndex: number,
    from: string,
    to: string,
    room_id: string | null,
    created_by: string,
    others: [string, AttendeeResponse][],
    canceled = false,
  ) => {
    events.push({
      id,
      title,
      description: null,
      starts_at: at(dayIndex, from),
      ends_at: at(dayIndex, to),
      room_id,
      created_by,
      created_at: now,
      updated_at: now,
      canceled_at: canceled ? now : null,
    });
    attendees.push({ event_id: id, user_id: created_by, response: "accepted", responded_at: now });
    for (const [user_id, response] of others) {
      attendees.push({
        event_id: id,
        user_id,
        response,
        responded_at: response === "pending" ? null : now,
      });
    }
  };
  // B 가 A 를 초대한 회의 (A 수락)
  add("ev-1", "주간 기획 회의", 1, "10:00", "11:00", "room-1", "demo-b", [["demo-a", "accepted"]]);
  // A 가 B 를 초대 (B 아직 응답 안 함)
  add("ev-2", "디자인 리뷰", 2, "14:00", "15:30", "room-2", "demo-a", [
    ["demo-b", "pending"],
    ["demo-d", "accepted"],
  ]);
  // B 가 들어가지 않은 회의 — B 에게는 회의실 현황의 회색 칸으로만 보여야 한다
  add("ev-3", "영업 전략 (비공개)", 1, "13:00", "14:00", "room-1", "demo-c", [["demo-admin", "accepted"]]);
  // 취소된 회의 — 줄을 그어 보이고, 회의실 자리는 비운다
  add("ev-4", "취소된 점심 세미나", 3, "12:00", "13:00", "room-3", "demo-b", [["demo-e", "declined"]], true);
  // 회의실 없이 잡은 회의
  add("ev-5", "1:1 면담", 4, "16:00", "16:30", null, "demo-f", [["demo-b", "accepted"]]);
}
seed();

// ── 규칙 ────────────────────────────────────────────────────

const isParticipant = (eventId: string, userId: string) =>
  attendees.some((a) => a.event_id === eventId && a.user_id === userId);

const withAttendees = (e: CalendarEvent): EventWithAttendees => ({
  ...e,
  attendees: attendees.filter((a) => a.event_id === e.id).map((a) => ({ ...a })),
});

// '[)' 범위: 10:00~11:00 과 11:00~12:00 은 겹치지 않는다
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  toMs(aStart) < toMs(bEnd) && toMs(bStart) < toMs(aEnd);

const byStart = (a: { starts_at: string }, b: { starts_at: string }) =>
  toMs(a.starts_at) - toMs(b.starts_at);

function validate(input: EventInput) {
  const title = input.title.trim();
  if (!title || title.length > TITLE_MAX) throw new Error(`제목은 1~${TITLE_MAX}자로 적어 주세요`);
  if (!(toMs(input.ends_at) > toMs(input.starts_at))) {
    throw new Error("끝나는 시각이 시작보다 늦어야 합니다");
  }
}

// crypto.randomUUID 는 https·localhost 에서만 있다 (같은 네트워크의 http://<IP>:3000 접속 대비)
function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function assertRoomFree(input: EventInput, ignoreEventId?: string) {
  if (!input.room_id) return;
  const clash = events.some(
    (e) =>
      e.id !== ignoreEventId &&
      e.room_id === input.room_id &&
      e.canceled_at === null &&
      overlaps(e.starts_at, e.ends_at, input.starts_at, input.ends_at),
  );
  if (clash) throw new RoomConflictError();
}

// ── 화면이 부르는 함수 ──────────────────────────────────────

export async function listRooms(): Promise<Room[]> {
  return rooms.map((r) => ({ ...r }));
}

/** 내가 만들었거나 초대받은 회의 중 [from, to) 와 겹치는 것 */
export async function listMyEvents(from: Date, to: Date): Promise<EventWithAttendees[]> {
  const f = from.toISOString();
  const t = to.toISOString();
  return events
    .filter((e) => isParticipant(e.id, me) && overlaps(e.starts_at, e.ends_at, f, t))
    .sort(byStart)
    .map(withAttendees);
}

/** 참석자가 아니면 null (남의 회의는 id 를 알아도 못 본다) */
export async function getEvent(id: string): Promise<EventWithAttendees | null> {
  const e = events.find((x) => x.id === id);
  return e && isParticipant(e.id, me) ? withAttendees(e) : null;
}

/** 회의실의 예약된 시간대만 돌려준다 (제목·참석자는 주지 않는다) */
export async function roomBusy(roomId: string, from: Date, to: Date): Promise<BusySlot[]> {
  const f = from.toISOString();
  const t = to.toISOString();
  return events
    .filter(
      (e) => e.room_id === roomId && e.canceled_at === null && overlaps(e.starts_at, e.ends_at, f, t),
    )
    .sort(byStart)
    .map((e) => ({ starts_at: e.starts_at, ends_at: e.ends_at }));
}

export async function createEvent(input: EventInput): Promise<EventWithAttendees> {
  validate(input);
  assertRoomFree(input);
  const now = new Date().toISOString();
  const event: CalendarEvent = {
    id: newId(),
    title: input.title.trim(),
    description: input.description?.trim() || null,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    room_id: input.room_id,
    created_by: me,
    created_at: now,
    updated_at: now,
    canceled_at: null,
  };
  events.push(event);
  attendees.push({ event_id: event.id, user_id: me, response: "accepted", responded_at: now });
  for (const user_id of new Set(input.attendee_ids)) {
    if (user_id !== me) {
      attendees.push({ event_id: event.id, user_id, response: "pending", responded_at: null });
    }
  }
  return withAttendees(event);
}

/** 만든 사람만. 남아 있는 참석자의 응답은 그대로 두고, 새 참석자는 "응답 전"으로 넣는다 */
export async function updateEvent(id: string, input: EventInput): Promise<EventWithAttendees> {
  const event = events.find((e) => e.id === id);
  if (!event || !isParticipant(id, me)) throw new ForbiddenError("회의를 찾을 수 없습니다");
  if (event.created_by !== me) throw new ForbiddenError("만든 사람만 고칠 수 있습니다");
  if (event.canceled_at) throw new ForbiddenError("취소된 회의는 고칠 수 없습니다");
  validate(input);
  assertRoomFree(input, id);

  Object.assign(event, {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    room_id: input.room_id,
    updated_at: new Date().toISOString(),
  });
  const keep = new Set([me, ...input.attendee_ids]);
  for (let i = attendees.length - 1; i >= 0; i--) {
    if (attendees[i].event_id === id && !keep.has(attendees[i].user_id)) attendees.splice(i, 1);
  }
  for (const user_id of keep) {
    if (!isParticipant(id, user_id)) {
      attendees.push({ event_id: id, user_id, response: "pending", responded_at: null });
    }
  }
  return withAttendees(event);
}

/** 만든 사람만. 지우지 않고 canceled_at 을 채운다 (회의실 자리는 비워진다) */
export async function cancelEvent(id: string): Promise<void> {
  const event = events.find((e) => e.id === id);
  if (!event || !isParticipant(id, me)) throw new ForbiddenError("회의를 찾을 수 없습니다");
  if (event.created_by !== me) throw new ForbiddenError("만든 사람만 취소할 수 있습니다");
  event.canceled_at ??= new Date().toISOString();
}

/** 본인 응답만 바꾼다 */
export async function respond(id: string, response: AttendeeResponse): Promise<void> {
  const row = attendees.find((a) => a.event_id === id && a.user_id === me);
  if (!row) throw new ForbiddenError("초대받은 회의가 아닙니다");
  row.response = response;
  row.responded_at = new Date().toISOString();
}
