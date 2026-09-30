// ② 캘린더에 그릴 한 칸(item). 내 일정(events)과 같은 부서 팀원의 일정(list_team_events)을 같은 모양으로 합친다.
// 날짜는 모두 한국 날짜 키 "YYYY-MM-DD" 로 다룬다 (time.ts). 종일 일정은 한국 0시 ~ 다음 날 0시로 저장돼 있다.

import type { EventCategory, EventKind, TeamEvent } from "@/lib/types/calendar";
import type { EventWithAttendees } from "./source";
import type { ColorKey } from "./kinds";
import { fromKstInput, kstDateKey, toMs } from "./time";

export type CalItem = {
  /** 목록 key. 팀원 일정은 "team:" 를 붙인다 */
  key: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  color: ColorKey;
  category: EventCategory;
  canceled: boolean;
  /** 내 일정 (참석자라 읽을 수 있는 것) */
  event?: EventWithAttendees;
  /** 팀원의 일정 (가려진 칸만) */
  team?: TeamEvent & { name: string };
};

export type Filters = {
  cats: Record<EventCategory, boolean>;
  types: Record<EventKind, boolean>;
};

export const DEFAULT_FILTERS: Filters = {
  cats: { mine: true, team: true, project: true },
  types: { meeting: true, work: true, personal: true, outside: true, leave: true },
};

export function eventItem(e: EventWithAttendees): CalItem {
  return {
    key: e.id,
    title: e.title,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    all_day: e.all_day,
    color: e.kind,
    category: e.category,
    canceled: e.canceled_at !== null,
    event: e,
  };
}

/** 팀원 일정: "정하늘 연차", "이서연 · 시안 마감", "박도윤 바쁨" */
export function teamItem(t: TeamEvent, name: string): CalItem {
  return {
    key: `team:${t.event_id}`,
    title: t.title ? `${name} · ${t.title}` : `${name} ${t.label}`,
    starts_at: t.starts_at,
    ends_at: t.ends_at,
    all_day: t.all_day,
    color: t.kind ?? "busy",
    category: "team",
    canceled: false,
    team: { ...t, name },
  };
}

/** 필터: 팀원 일정은 "팀 일정"을 켜야 보이고, "바쁨"은 유형을 모르므로 유형 필터를 타지 않는다 */
export function passes(item: CalItem, f: Filters): boolean {
  if (!f.cats[item.category]) return false;
  if (item.color === "busy") return true;
  return f.types[item.color];
}

// ── 날짜 키 ──
const keyToDate = (key: string) => fromKstInput(key, "00:00");
export const addDaysKey = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};
/** 0=일 … 6=토 */
export const weekdayOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
/** 그 주 월요일 */
export const mondayOf = (key: string) => addDaysKey(key, -((weekdayOf(key) + 6) % 7));
/** "YYYY-MM" 의 n 달 뒤 */
export const addMonthKey = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
};
/** 달력 격자(월요일 시작)의 첫날과 마지막 날 */
export function monthGrid(month: string): { first: string; last: string; days: string[] } {
  const first = mondayOf(`${month}-01`);
  const lastOfMonth = addDaysKey(`${addMonthKey(month, 1)}-01`, -1);
  const last = addDaysKey(mondayOf(lastOfMonth), 6);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDaysKey(d, 1)) days.push(d);
  return { first, last, days };
}
export const dayStart = (key: string) => keyToDate(key);

/** 그 일정이 걸친 한국 날짜들 (끝은 제외 — 10:00~11:00 은 그날 하루, 종일 1일 0시~2일 0시는 1일 하루) */
export function daysOf(item: { starts_at: string; ends_at: string }): string[] {
  const first = kstDateKey(item.starts_at);
  const lastMs = Math.max(toMs(item.starts_at), toMs(item.ends_at) - 1);
  const last = kstDateKey(new Date(lastMs));
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 62; d = addDaysKey(d, 1)) out.push(d);
  return out;
}

/** 날짜마다 그날의 일정 (종일 먼저, 그다음 시작 시각 순) */
export function byDay(items: CalItem[]): Map<string, CalItem[]> {
  const map = new Map<string, CalItem[]>();
  for (const it of items) {
    for (const d of daysOf(it)) {
      const list = map.get(d);
      if (list) list.push(it);
      else map.set(d, [it]);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.all_day) - Number(a.all_day) || toMs(a.starts_at) - toMs(b.starts_at));
  }
  return map;
}
