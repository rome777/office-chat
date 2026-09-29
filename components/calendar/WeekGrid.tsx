"use client";

// ② 주간 보기. 월~일 7칸, 08~21시. 겹치는 회의는 옆으로 나란히 놓는다.

import type { EventWithAttendees } from "./source";
import { addDays, formatKstDay, formatKstTime, kstDateKey, kstMinuteOfDay, toMs } from "./time";
import s from "./calendar.module.css";

export const HOUR_START = 8;
export const HOUR_END = 21;
const HOUR_PX = 48;

export default function WeekGrid({
  weekStart,
  events,
  myId,
  onSelect,
}: {
  weekStart: Date;
  events: EventWithAttendees[];
  myId: string;
  onSelect: (id: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = kstDateKey(new Date());
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

  return (
    <div className={s.gridScroll}>
      <div className={s.grid} style={{ ["--hour-px" as string]: `${HOUR_PX}px` }}>
        <div className={s.corner} />
        {days.map((d) => (
          <div
            key={d.toISOString()}
            className={`${s.dayHead} ${kstDateKey(d) === today ? s.today : ""}`}
          >
            {formatKstDay(d)}
          </div>
        ))}

        <div className={s.hours}>
          {hours.map((h) => (
            <div key={h} className={s.hour}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {days.map((d) => (
          <DayColumn
            key={d.toISOString()}
            dayKey={kstDateKey(d)}
            events={events.filter((e) => kstDateKey(e.starts_at) === kstDateKey(d))}
            myId={myId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  dayKey,
  events,
  myId,
  onSelect,
}: {
  dayKey: string;
  events: EventWithAttendees[];
  myId: string;
  onSelect: (id: string) => void;
}) {
  const lanes = assignLanes(events);
  const laneCount = Math.max(1, ...[...lanes.values()].map((l) => l + 1));
  const top = HOUR_START * 60;
  const bottom = HOUR_END * 60;

  return (
    <div className={s.dayCol} data-day={dayKey}>
      {events.map((e) => {
        // 자정을 넘기는 회의는 그날 끝까지만 그린다
        const endsSameDay = kstDateKey(e.ends_at) === dayKey;
        const rawFrom = kstMinuteOfDay(e.starts_at);
        const rawTo = endsSameDay ? kstMinuteOfDay(e.ends_at) : 24 * 60;
        // 보이는 시간(08~21시) 밖의 회의는 위·아래 끝에 30분 크기로 붙인다 (글자에는 실제 시각이 나온다)
        const from = Math.min(Math.max(rawFrom, top), bottom - 30);
        const to = Math.max(Math.min(rawTo, bottom), from + 30);
        const outside = rawTo <= top || rawFrom >= bottom;
        const mine = e.attendees.find((a) => a.user_id === myId);
        const lane = lanes.get(e.id) ?? 0;
        const classes = [
          s.event,
          e.canceled_at ? s.canceled : "",
          mine?.response === "pending" ? s.pending : "",
          mine?.response === "declined" ? s.declined : "",
          outside ? s.outside : "",
        ].join(" ");
        return (
          <button
            key={e.id}
            type="button"
            className={classes}
            aria-label={`${e.title}, ${formatKstTime(e.starts_at)}~${formatKstTime(e.ends_at)}${
              e.canceled_at ? ", 취소됨" : mine?.response === "pending" ? ", 응답 전" : ""
            }`}
            style={{
              top: `calc(${(from - top) / 60} * var(--hour-px))`,
              height: `max(22px, calc(${(to - from) / 60} * var(--hour-px) - 2px))`,
              left: `${(lane / laneCount) * 100}%`,
              width: `${100 / laneCount}%`,
            }}
            onClick={() => onSelect(e.id)}
          >
            <span className={s.eventTitle}>{e.title}</span>
            <span className={s.eventTime}>
              {formatKstTime(e.starts_at)}~{formatKstTime(e.ends_at)}
              {e.canceled_at ? " · 취소됨" : mine?.response === "pending" ? " · 응답 전" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 시간이 겹치는 회의를 서로 다른 줄(lane)에 놓는다 */
function assignLanes(events: EventWithAttendees[]): Map<string, number> {
  const lanes = new Map<string, number>();
  const laneEnds: number[] = [];
  for (const e of [...events].sort((a, b) => toMs(a.starts_at) - toMs(b.starts_at))) {
    const start = toMs(e.starts_at);
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = toMs(e.ends_at);
    lanes.set(e.id, lane);
  }
  return lanes;
}
