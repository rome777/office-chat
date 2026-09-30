// ② 일정 유형·세부 유형·공개 범위·분류·알림 시각의 이름과 색, 공휴일.
// 화면 여러 곳(캘린더·목록·패널·대시보드)이 같이 쓴다. 값은 DB 제약(20260930230000_schedule_v2.sql)과 같다.

import type { EventCategory, EventKind, Visibility } from "@/lib/types/calendar";

export const KINDS: { value: EventKind; label: string; subtypes: { value: string; label: string }[] }[] = [
  {
    value: "meeting",
    label: "회의",
    subtypes: [
      { value: "meeting", label: "회의" },
      { value: "team_meeting", label: "팀 미팅" },
      { value: "project_talk", label: "프로젝트 논의" },
      { value: "one_on_one", label: "면담" },
    ],
  },
  {
    value: "work",
    label: "업무",
    subtypes: [
      { value: "deadline", label: "업무 마감" },
      { value: "design", label: "디자인 작업" },
      { value: "project", label: "프로젝트" },
      { value: "focus", label: "집중 시간" },
    ],
  },
  {
    value: "personal",
    label: "개인",
    subtypes: [
      { value: "appointment", label: "개인 약속" },
      { value: "hospital", label: "병원" },
      { value: "errand", label: "개인 용무" },
      { value: "meal", label: "식사" },
      { value: "anniversary", label: "개인 기념일" },
    ],
  },
  {
    value: "outside",
    label: "외근",
    subtypes: [
      { value: "client_visit", label: "거래처 방문" },
      { value: "trip", label: "출장" },
      { value: "external_meeting", label: "외부 미팅" },
      { value: "site_visit", label: "현장 방문" },
    ],
  },
  {
    value: "leave",
    label: "휴가·부재",
    subtypes: [
      { value: "annual", label: "연차" },
      { value: "half", label: "반차" },
      { value: "sick", label: "병가" },
      { value: "leave_of_absence", label: "휴직" },
      { value: "other", label: "기타 부재" },
    ],
  },
];

export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<EventKind, string>;

export function subtypeLabel(kind: EventKind, subtype: string | null): string {
  return KINDS.find((k) => k.value === kind)?.subtypes.find((st) => st.value === subtype)?.label ?? "";
}

/** 제목을 비웠을 때 쓰는 이름 (휴가·부재는 "부재") */
export const titleFallback = (kind: EventKind) => (kind === "leave" ? "부재" : KIND_LABEL[kind]);

/** 제목 칸의 흐린 예시: "예: 개인 약속, 병원, 개인 용무, 식사, 개인 기념일" */
export const titleExamples = (kind: EventKind) =>
  `예: ${(KINDS.find((k) => k.value === kind)?.subtypes ?? []).map((st) => st.label).join(", ")}`;

/** 세부 유형은 고르지 않고 제목에서 알아낸다 (2026-10-01 사용자 결정 — 버튼을 없앰).
 *  휴가·부재는 팀에게 보이는 말(병가 → "휴가")을 정하는 데 쓴다. 못 알아내면 null (팀에는 "부재") */
export function detectSubtype(kind: EventKind, title: string): string | null {
  const t = title.replace(/\s+/g, "");
  const subs = KINDS.find((k) => k.value === kind)?.subtypes ?? [];
  const hit = subs.find((st) => t.includes(st.label.replace(/\s+/g, "")));
  if (hit) return hit.value;
  if (kind === "leave") {
    if (t.includes("기타")) return "other";
    if (t.includes("휴가")) return "annual";
  }
  return null;
}

/** 색은 globals.css 의 --k-* 변수. busy 는 팀원의 "바쁨" (유형을 드러내지 않는다) */
export type ColorKey = EventKind | "busy";
export const colorVar = (key: ColorKey) => `var(--k-${key})`;

export const CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: "mine", label: "내 일정" },
  { value: "team", label: "팀 일정" },
  { value: "project", label: "프로젝트 일정" },
];
export const CATEGORY_LABEL: Record<EventCategory, string> = { mine: "내 일정", team: "팀 일정", project: "프로젝트 일정" };

/** 공개 범위 (회의는 고르지 않는다 — 참석자에게만) */
export const VISIBILITIES: { value: Visibility; label: string }[] = [
  { value: "public", label: "팀에 공개" },
  { value: "time_only", label: "시간만 공개" },
  { value: "private", label: "나만 보기" },
];

/** 유형마다 기본 공개 범위 — 개인만 시간만 공개 (DB create_event 와 같다) */
export const defaultVisibility = (kind: EventKind): Visibility => (kind === "personal" ? "time_only" : "public");

/** 같은 부서 팀원에게 보이는 모습 (DB list_team_events 와 같은 규칙). 패널의 미리보기에 쓴다 */
export function teamPreview(kind: EventKind, visibility: Visibility, subtype: string | null): string {
  if (kind === "meeting") return "참석자에게만 보입니다";
  if (visibility === "private") return "팀원에게 보이지 않습니다";
  if (visibility === "time_only") {
    return kind === "outside" ? '"외근"과 시간만 (장소·거래처 없이)' : kind === "leave" ? '"부재"와 기간만 (사유 없이)' : '"바쁨"과 시간만';
  }
  if (kind === "work") return "일정명 · 시작~마감 · 담당자";
  if (kind === "personal") return '"개인 일정"과 시간만 (제목·내용 없이)';
  if (kind === "outside") return "일정명 · 장소 · 시간";
  const shown = subtype === "sick" ? "휴가" : subtype === "leave_of_absence" ? "부재" : subtypeLabel("leave", subtype) || "부재";
  return `"${shown}" 표시와 기간 (내용 없이${subtype === "sick" || subtype === "leave_of_absence" ? ", 종류는 숨김" : ""})`;
}

/** 시작 전 알림 (DB 제약과 같은 값만) */
export const REMINDERS: { minutes: number; label: string }[] = [
  { minutes: 5, label: "5분 전" },
  { minutes: 10, label: "10분 전" },
  { minutes: 30, label: "30분 전" },
  { minutes: 60, label: "1시간 전" },
  { minutes: 1440, label: "하루 전" },
];
export const reminderLabel = (m: number) => REMINDERS.find((r) => r.minutes === m)?.label ?? `${m}분 전`;

/** 유형마다 처음 넣어 두는 알림 */
export function defaultReminders(kind: EventKind, allDay: boolean): number[] {
  if (kind === "leave" || allDay) return [];
  return kind === "personal" || kind === "outside" ? [60] : [10];
}

/** 공휴일 (대체 공휴일 포함) 2026~2027. 해가 바뀌기 전에 다음 해를 더한다. 날짜 키는 한국 날짜 "YYYY-MM-DD" */
export const HOLIDAYS: Record<string, string> = {
  "2026-01-01": "신정",
  "2026-02-16": "설날",
  "2026-02-17": "설날",
  "2026-02-18": "설날",
  "2026-03-01": "삼일절",
  "2026-03-02": "대체 공휴일",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "대체 공휴일",
  "2026-06-03": "지방선거",
  "2026-06-06": "현충일",
  "2026-08-15": "광복절",
  "2026-08-17": "대체 공휴일",
  "2026-09-24": "추석",
  "2026-09-25": "추석",
  "2026-09-26": "추석",
  "2026-10-03": "개천절",
  "2026-10-05": "대체 공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
  "2027-01-01": "신정",
  "2027-02-06": "설날",
  "2027-02-07": "설날",
  "2027-02-08": "설날",
  "2027-02-09": "대체 공휴일",
  "2027-03-01": "삼일절",
  "2027-05-05": "어린이날",
  "2027-05-13": "부처님오신날",
  "2027-06-06": "현충일",
  "2027-08-15": "광복절",
  "2027-08-16": "대체 공휴일",
  "2027-09-14": "추석",
  "2027-09-15": "추석",
  "2027-09-16": "추석",
  "2027-10-03": "개천절",
  "2027-10-04": "대체 공휴일",
  "2027-10-09": "한글날",
  "2027-10-11": "대체 공휴일",
  "2027-12-25": "성탄절",
  "2027-12-27": "대체 공휴일",
};
