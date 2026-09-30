"use client";

// ② 일정 서브 메뉴 칸 (메시지 화면의 목록 칸과 같은 자리): 일정 만들기 · 미니 캘린더 · 분류 · 유형 필터.

import type { EventCategory, EventKind } from "@/lib/types/calendar";
import { CATEGORIES, KINDS, colorVar } from "./kinds";
import type { Filters } from "./items";
import MiniCalendar from "./MiniCalendar";
import s from "./schedule.module.css";

const CATEGORY_COLOR: Record<EventCategory, string> = {
  mine: "var(--muted)",
  team: "var(--primary)",
  project: "var(--k-work)",
};

export default function CalendarNav({
  month,
  selected,
  today,
  marked,
  filters,
  onFilters,
  onSelect,
  onMonthChange,
  onCreate,
}: {
  month: string;
  selected: string;
  today: string;
  marked: ReadonlySet<string>;
  filters: Filters;
  onFilters: (f: Filters) => void;
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
  onCreate: () => void;
}) {
  const setCat = (c: EventCategory, on: boolean) => onFilters({ ...filters, cats: { ...filters.cats, [c]: on } });
  const setType = (t: EventKind, on: boolean) => onFilters({ ...filters, types: { ...filters.types, [t]: on } });
  const typeBox = (t: EventKind, label: string) => (
    <label key={t} className={s.check}>
      <input
        type="checkbox"
        checked={filters.types[t]}
        onChange={(e) => setType(t, e.target.checked)}
        style={{ ["--c" as string]: colorVar(t) }}
      />
      {label}
    </label>
  );

  return (
    <aside className={s.side} aria-label="일정 메뉴">
      <h2>일정</h2>
      <button type="button" className={`${s.primary} ${s.createButton}`} onClick={onCreate}>
        + 일정 만들기
      </button>
      <MiniCalendar month={month} selected={selected} today={today} marked={marked} onSelect={onSelect} onMonthChange={onMonthChange} />
      <div className={s.group} role="group" aria-label="분류">
        <h3>분류</h3>
        {CATEGORIES.map((c) => (
          <label key={c.value} className={s.check}>
            <input
              type="checkbox"
              checked={filters.cats[c.value]}
              onChange={(e) => setCat(c.value, e.target.checked)}
              style={{ ["--c" as string]: CATEGORY_COLOR[c.value] }}
            />
            {c.label}
          </label>
        ))}
      </div>
      <div className={s.group} role="group" aria-label="유형">
        <h3>유형</h3>
        {KINDS.map((k) => typeBox(k.value, k.label))}
      </div>
      <p className={s.sideNote}>
        회의는 참석자에게만 보입니다. 같은 부서 팀원의 업무·개인·외근·휴가는 그 사람이 고른 공개 범위만큼 "팀 일정"에 보입니다.
      </p>
    </aside>
  );
}
