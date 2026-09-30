"use client";

// ② 월 보기. 날짜를 누르면 선택(아래 목록이 그 날짜로), 두 번 누르면 그 날짜로 일정 만들기.
// 칸마다 일정 3개까지, 나머지는 "+N개 더"(누르면 그 날짜 선택 — 아래 목록에 다 나온다).

import { HOLIDAYS, colorVar } from "./kinds";
import { monthGrid, weekdayOf, type CalItem } from "./items";
import { formatKstTime } from "./time";
import s from "./schedule.module.css";

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const MAX_CHIPS = 3;

export function Chip({ item, onOpen }: { item: CalItem; onOpen: (item: CalItem) => void }) {
  const cls = [s.chip, item.all_day ? s.allDay : "", item.team ? s.teamShared : "", item.canceled ? s.canceled : ""].join(" ");
  const time = item.all_day ? "" : formatKstTime(item.starts_at);
  return (
    <button
      type="button"
      className={cls}
      style={{ ["--c" as string]: colorVar(item.color) }}
      title={`${time ? `${time} ` : ""}${item.title}${item.canceled ? " (취소됨)" : ""}`}
      data-item="1"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(item);
      }}
    >
      {time && <span className={s.chipTime}>{time}</span>}
      <span>{item.title}</span>
    </button>
  );
}

export default function MonthGrid({
  month,
  selected,
  today,
  days,
  onSelect,
  onCreate,
  onOpen,
}: {
  month: string;
  selected: string;
  today: string;
  days: Map<string, CalItem[]>;
  onSelect: (date: string) => void;
  onCreate: (date: string) => void;
  onOpen: (item: CalItem) => void;
}) {
  const grid = monthGrid(month).days;
  return (
    <div className={s.month} role="grid" aria-label={`${Number(month.slice(5))}월 달력`}>
      {DOW.map((d) => (
        <div key={d} className={s.dow} role="columnheader">
          {d}
        </div>
      ))}
      {grid.map((d) => {
        const list = days.get(d) ?? [];
        const w = weekdayOf(d);
        const cls = [
          s.cell,
          d.slice(0, 7) !== month ? s.out : "",
          d === today ? s.today : "",
          d === selected ? s.sel : "",
          HOLIDAYS[d] || w === 0 ? s.red : "",
          w === 6 && !HOLIDAYS[d] ? s.sat : "",
        ].join(" ");
        return (
          <div
            key={d}
            className={cls}
            role="gridcell"
            tabIndex={d === selected ? 0 : -1}
            aria-selected={d === selected}
            aria-label={`${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일${HOLIDAYS[d] ? ` ${HOLIDAYS[d]}` : ""}, 일정 ${list.length}건`}
            onClick={() => onSelect(d)}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).closest("[data-item]")) return;
              onCreate(d);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCreate(d);
              }
            }}
          >
            <div className={s.cellTop}>
              <span className={s.num}>{Number(d.slice(8))}</span>
              {HOLIDAYS[d] && <span className={s.holiday}>{HOLIDAYS[d]}</span>}
            </div>
            {list.slice(0, MAX_CHIPS).map((it) => (
              <Chip key={it.key} item={it} onOpen={onOpen} />
            ))}
            {list.length > MAX_CHIPS && (
              <button
                type="button"
                className={s.more}
                data-item="1"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(d);
                }}
              >
                +{list.length - MAX_CHIPS}개 더
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
