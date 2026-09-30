"use client";

// ② 주 보기(7칸)·일 보기(1칸). 08~21시, 겹치는 일정은 옆으로 나란히. 종일 일정은 맨 위 줄.
// 시간 칸을 두 번 누르면 그 시각(30분 단위)으로 일정 만들기. 날짜 머리를 누르면 그 날짜 선택.

import type { MouseEvent } from "react";
import { HOLIDAYS, colorVar } from "./kinds";
import { Chip } from "./MonthGrid";
import { dayStart, weekdayOf, type CalItem } from "./items";
import { formatKstTime, kstDateKey, kstMinuteOfDay, toMs } from "./time";
import s from "./schedule.module.css";

export const HOUR_START = 8;
export const HOUR_END = 21;
const HOUR_PX = 44;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_MS = 24 * 60 * 60 * 1000;

type Placed = { item: CalItem; from: number; to: number; lane: number; lanes: number };

/** 그날 칸 안에서 차지하는 분(0~1440). 자정을 넘기는 일정은 그날 몫만 */
function clip(item: CalItem, key: string): { from: number; to: number } {
  const start = dayStart(key).getTime();
  const a = Math.max(toMs(item.starts_at), start);
  const b = Math.min(toMs(item.ends_at), start + DAY_MS);
  return { from: Math.round((a - start) / 60000), to: Math.round((b - start) / 60000) };
}

function place(items: CalItem[], key: string): Placed[] {
  const top = HOUR_START * 60;
  const bottom = HOUR_END * 60;
  const raw = items
    .map((item) => {
      const c = clip(item, key);
      // 보이는 시간(08~21시) 밖의 일정은 위·아래 끝에 30분 크기로 붙인다 (글자에는 실제 시각이 나온다)
      const from = Math.min(Math.max(c.from, top), bottom - 30);
      const to = Math.max(Math.min(c.to, bottom), from + 30);
      return { item, from, to };
    })
    .sort((a, b) => a.from - b.from || b.to - a.to);
  // 서로 겹치는 묶음마다 줄 수를 센다 (오전에 셋이 겹쳐도 오후의 혼자인 일정은 한 칸 전체)
  const out: Placed[] = [];
  let group: Placed[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    group.forEach((p) => out.push({ ...p, lanes }));
    group = [];
    laneEnds = [];
  };
  for (const r of raw) {
    if (group.length && r.from >= groupEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= r.from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = r.to;
    groupEnd = Math.max(group.length ? groupEnd : -1, r.to);
    group.push({ ...r, lane, lanes: 0 });
  }
  flush();
  return out;
}

export default function TimeGrid({
  days,
  byDay,
  selected,
  today,
  myId,
  onSelect,
  onCreate,
  onOpen,
}: {
  days: string[];
  byDay: Map<string, CalItem[]>;
  selected: string;
  today: string;
  /** 내가 아직 답하지 않은 초대는 테두리를 점선으로 */
  myId: string;
  onSelect: (date: string) => void;
  onCreate: (date: string, time: string) => void;
  onOpen: (item: CalItem) => void;
}) {
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const single = days.length === 1;
  const nowMin = kstMinuteOfDay(new Date());

  const createAt = (key: string, e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-item]")) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const minute = Math.min((HOUR_END - 1) * 60 + 30, HOUR_START * 60 + Math.floor((y / HOUR_PX) * 2) * 30);
    onCreate(key, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  };

  return (
    <div
      className={s.week}
      style={{
        ["--cols" as string]: days.length,
        ["--hour-px" as string]: `${HOUR_PX}px`,
        ["--hour-start" as string]: HOUR_START,
        ["--hour-end" as string]: HOUR_END,
      }}
    >
      <div className={s.weekHead}>
        <div />
        {days.map((d) => {
          const w = weekdayOf(d);
          const red = HOLIDAYS[d] || w === 0;
          return (
            <button
              key={d}
              type="button"
              className={`${s.dayHead} ${d === today ? s.today : ""} ${d === selected ? s.sel : ""}`}
              aria-pressed={d === selected}
              onClick={() => onSelect(d)}
            >
              <small className={red ? s.redText : w === 6 ? s.blueText : undefined}>
                {DOW[w]}
                {HOLIDAYS[d] ? ` · ${HOLIDAYS[d]}` : ""}
              </small>
              <strong>{single ? `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일` : Number(d.slice(8))}</strong>
            </button>
          );
        })}
      </div>
      <div className={s.weekAll}>
        <div>종일</div>
        {days.map((d) => (
          <div key={d}>
            {(byDay.get(d) ?? [])
              .filter((it) => it.all_day)
              .map((it) => (
                <Chip key={it.key} item={it} onOpen={onOpen} />
              ))}
          </div>
        ))}
      </div>
      <div className={s.weekBody}>
        <div className={s.hours} aria-hidden="true">
          {hours.slice(1).map((h) => (
            <span key={h} style={{ top: (h - HOUR_START) * HOUR_PX }}>
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div
            key={d}
            className={`${s.col} ${d === selected ? s.sel : ""}`}
            onDoubleClick={(e) => createAt(d, e)}
            aria-label={`${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일 시간표. 두 번 누르면 그 시각으로 일정 만들기`}
          >
            {place((byDay.get(d) ?? []).filter((it) => !it.all_day), d).map((p) => {
              const it = p.item;
              const top = ((p.from - HOUR_START * 60) / 60) * HOUR_PX;
              const height = Math.max(20, ((p.to - p.from) / 60) * HOUR_PX - 2);
              const pending = it.event?.attendees.some((a) => a.user_id === myId && a.response === "pending") ?? false;
              const where = it.event ? it.event.location : (it.team?.location ?? null);
              const cls = [s.block, it.team ? s.teamShared : "", it.canceled ? s.canceled : "", pending ? s.pending : ""].join(" ");
              return (
                <button
                  key={it.key}
                  type="button"
                  className={cls}
                  data-item="1"
                  style={{
                    ["--c" as string]: colorVar(it.color),
                    top,
                    height,
                    left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / p.lanes}% - 4px)`,
                  }}
                  title={`${formatKstTime(it.starts_at)}~${formatKstTime(it.ends_at)} ${it.title}`}
                  onClick={() => onOpen(it)}
                >
                  <b>{it.title}</b>
                  <span>
                    {formatKstTime(it.starts_at)}~{formatKstTime(it.ends_at)}
                    {kstDateKey(it.starts_at) !== d ? " (전날부터)" : ""}
                  </span>
                  {single && where && <span>{where}</span>}
                </button>
              );
            })}
            {d === today && nowMin >= HOUR_START * 60 && nowMin <= HOUR_END * 60 && (
              <div className={s.now} style={{ top: ((nowMin - HOUR_START * 60) / 60) * HOUR_PX }} aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
