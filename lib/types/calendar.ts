// ② 캘린더·일정 영역의 타입 (TECH_SPEC 4절 `rooms`·`events`·`event_attendees`)

export type Room = {
  id: string;
  name: string;
  capacity: number | null;
  location: string | null;
};

/** 일정 유형 (2026-10-01 일정 개편). 세부 유형은 components/calendar/kinds.ts */
export type EventKind = "meeting" | "work" | "personal" | "outside" | "leave";

/** 공개 범위 — 같은 부서 팀원에게 보이는 정도. 회의는 쓰지 않는다 (참석자에게만) */
export type Visibility = "public" | "time_only" | "private";

/** 분류 — 저장할 때 DB 트리거가 정한다 (팀 전원 참석 → team, 일반 채널에서 만듦 → project, 나머지 → mine) */
export type EventCategory = "mine" | "team" | "project";

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  room_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
  kind: EventKind;
  subtype: string | null;
  all_day: boolean;
  location: string | null;
  visibility: Visibility;
  channel_id: string | null;
  category: EventCategory;
  team_unit_id: string | null;
};

export type AttendeeResponse = "pending" | "accepted" | "declined";

export type EventAttendee = {
  event_id: string;
  user_id: string;
  response: AttendeeResponse;
  responded_at: string | null;
  /** 시작 몇 분 전에 알릴지 (5·10·30·60·1440). 빈 배열이면 알림 없음 */
  remind_minutes: number[];
};

/** 같은 부서 팀원의 일정 (list_team_events — 공개 범위에 맞게 가린 칸만 온다) */
export type TeamEvent = {
  event_id: string;
  user_id: string;
  /** "바쁨"(업무·개인을 시간만 공개)이면 null — 유형도 가린다 */
  kind: Exclude<EventKind, "meeting"> | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  /** "바쁨"·"개인 일정"·"업무"·"외근"·"연차"·"반차"·"휴가"·"부재"·"기타 부재" 등 */
  label: string;
  /** 업무·외근을 팀에 공개했을 때만 */
  title: string | null;
  /** 외근을 팀에 공개했을 때만 */
  location: string | null;
  /** 업무를 팀에 공개했을 때만 (담당자 = 참석자) */
  assignees: string[] | null;
};
