"use client";

// ② 미니 캘린더 (일정 서브 메뉴 — 대시보드에서도 쓸 수 있게 데이터 없이 날짜만 받는다).
// 일정이 있는 날은 점, 공휴일·일요일은 빨간 글자. 날짜를 누르면 onSelect.

import { HOLIDAYS } from "./kinds";
import { addMonthKey, monthGrid, weekdayOf } from "./items";
import s from "./schedule.module.css";

const DOW = ["월", "화", "수", "목", "금", "토", "일"];

export default function MiniCalendar({
  month,
  selected,
  today,
  marked,
  onSelect,
  onMonthChange,
}: {
  /** "YYYY-MM" */
  month: string;
  selected: string;
  today: string;
  /** 일정이 있는 날짜 키 */
  marked: ReadonlySet<string>;
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
}) {
  const { days } = monthGrid(month);
  const [y, m] = month.split("-").map(Number);
  return (
    <div className={s.mini}>
      <div className={s.miniHead}>
        <button type="button" className={s.iconButton} aria-label="이전 달" onClick={() => onMonthChange(addMonthKey(month, -1))}>
          ‹
        </button>
        <span>
          {y}년 {m}월
        </span>
        <button type="button" className={s.iconButton} aria-label="다음 달" onClick={() => onMonthChange(addMonthKey(month, 1))}>
          ›
        </button>
      </div>
      <div className={s.miniGrid}>
        {DOW.map((d) => (
          <span key={d} className={s.miniDow}>
            {d}
          </span>
        ))}
        {days.map((d) => {
          const cls = [
            s.miniDay,
            d.slice(0, 7) !== month ? s.out : "",
            HOLIDAYS[d] || weekdayOf(d) === 0 ? s.red : "",
            d === today ? s.today : "",
            d === selected ? s.sel : "",
            marked.has(d) ? s.has : "",
          ].join(" ");
          return (
            <button
              key={d}
              type="button"
              className={cls}
              aria-label={`${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일${HOLIDAYS[d] ? ` ${HOLIDAYS[d]}` : ""}${marked.has(d) ? ", 일정 있음" : ""}`}
              aria-current={d === selected ? "date" : undefined}
              onClick={() => onSelect(d)}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
