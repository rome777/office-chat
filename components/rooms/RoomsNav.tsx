"use client";

// ② 회의실 예약 서브 메뉴 칸 — 일정 화면(CalendarNav)과 같은 자리·모양.
// [+ 회의실 예약] · 미니 캘린더(내 예약 있는 날 점) · 인원 · 층 · 시설 · 지금 빈 곳만 · 예약 규칙 요약.

import type { Room, RoomFacility } from "@/lib/types/calendar";
import MiniCalendar from "@/components/calendar/MiniCalendar";
import cal from "@/components/calendar/schedule.module.css";
import { FACILITIES, RoomGlyph } from "./facilities";
import { ROOM_POLICY, hm } from "./policy";
import s from "./rooms.module.css";

export type RoomFilters = {
  /** 이 인원 이상 (0 = 전체) */
  cap: number;
  /** 숨길 층 (새 층이 생기면 기본으로 보이게 "숨김" 목록으로 둔다) */
  hideFloors: string[];
  /** 모두 갖춘 회의실만 */
  fac: RoomFacility[];
  /** 오늘 지금 쓸 수 있는 곳만 */
  freeNow: boolean;
};

export const DEFAULT_ROOM_FILTERS: RoomFilters = { cap: 0, hideFloors: [], fac: [], freeNow: false };

export const floorsOf = (rooms: Room[]) => [...new Set(rooms.map((r) => r.location ?? "기타"))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));

export default function RoomsNav({
  rooms,
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
  rooms: Room[];
  month: string;
  selected: string;
  today: string;
  marked: ReadonlySet<string>;
  filters: RoomFilters;
  onFilters: (f: RoomFilters) => void;
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
  onCreate: () => void;
}) {
  const count = (pred: (r: Room) => boolean) => rooms.filter(pred).length;
  const floors = floorsOf(rooms);
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v));

  return (
    <aside className={cal.side} aria-label="회의실 예약 메뉴">
      <h2>회의실 예약</h2>
      <button type="button" className={`${cal.primary} ${cal.createButton}`} onClick={onCreate}>
        + 회의실 예약
      </button>
      <MiniCalendar month={month} selected={selected} today={today} marked={marked} onSelect={onSelect} onMonthChange={onMonthChange} />

      <div className={cal.group} role="radiogroup" aria-label="인원">
        <h3>인원</h3>
        {[0, 4, 8, 12].map((c) => (
          <label key={c} className={cal.check}>
            <input type="radio" name="room-cap" className={s.round} checked={filters.cap === c} onChange={() => onFilters({ ...filters, cap: c })} />
            {c ? `${c}명 이상` : "전체"}
            <span className={s.count}>{count((r) => (r.capacity ?? 0) >= c)}</span>
          </label>
        ))}
      </div>

      {floors.length > 1 && (
        <div className={cal.group} role="group" aria-label="층">
          <h3>층</h3>
          {floors.map((f) => (
            <label key={f} className={cal.check}>
              <input
                type="checkbox"
                checked={!filters.hideFloors.includes(f)}
                onChange={(e) => onFilters({ ...filters, hideFloors: toggle(filters.hideFloors, f, !e.target.checked) })}
              />
              {f}
              <span className={s.count}>{count((r) => (r.location ?? "기타") === f)}</span>
            </label>
          ))}
        </div>
      )}

      <div className={cal.group} role="group" aria-label="시설">
        <h3>시설</h3>
        {FACILITIES.map((f) => (
          <label key={f.value} className={cal.check}>
            <input type="checkbox" checked={filters.fac.includes(f.value)} onChange={(e) => onFilters({ ...filters, fac: toggle(filters.fac, f.value, e.target.checked) })} />
            <span className={s.facIcon}>
              <RoomGlyph name={f.value} />
            </span>
            {f.label}
            <span className={s.count}>{count((r) => r.facilities.includes(f.value))}</span>
          </label>
        ))}
      </div>

      {selected === today && (
        <label className={cal.check}>
          <input type="checkbox" checked={filters.freeNow} onChange={(e) => onFilters({ ...filters, freeNow: e.target.checked })} />
          지금 빈 곳만
        </label>
      )}

      <div className={s.rules}>
        <strong>예약 규칙</strong>
        <span>
          {ROOM_POLICY.slot}분 단위 · {ROOM_POLICY.minMinutes}분~{ROOM_POLICY.maxMinutes / 60}시간
        </span>
        <span>
          {hm(ROOM_POLICY.open)}~{hm(ROOM_POLICY.close)} · 오늘부터 {ROOM_POLICY.windowDays}일
        </span>
        <span>시작 전 언제든 취소 · 진행 중이면 일찍 끝내기</span>
      </div>
    </aside>
  );
}
