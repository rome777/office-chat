"use client";

// ② 회의실 예약 현황. 회의실마다 그날 예약된 시간대를 회색 칸으로만 보여 준다 (누구의 무슨 회의인지는 없다).

import { useEffect, useState } from "react";
import type { Room } from "@/lib/types/calendar";
import { roomBusy, type BusySlot } from "./source";
import { addDays, formatKstTime, fromKstInput, kstMinuteOfDay } from "./time";
import { HOUR_END, HOUR_START } from "./WeekGrid";
import s from "./calendar.module.css";

export default function RoomBoard({
  rooms,
  date,
  onDateChange,
  version,
}: {
  rooms: Room[];
  date: string;
  onDateChange: (date: string) => void;
  /** 회의가 바뀔 때마다 늘려서 다시 불러온다 */
  version: number;
}) {
  const [busy, setBusy] = useState<Record<string, BusySlot[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    const from = fromKstInput(date, "00:00");
    const to = addDays(from, 1);
    void Promise.all(rooms.map((r) => roomBusy(r.id, from, to))).then(
      (all) => {
        if (!alive) return;
        setBusy(Object.fromEntries(rooms.map((r, i) => [r.id, all[i]])));
        setError(null);
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [rooms, date, version]);

  const span = (HOUR_END - HOUR_START) * 60;
  const pct = (iso: string) =>
    Math.min(100, Math.max(0, ((kstMinuteOfDay(iso) - HOUR_START * 60) / span) * 100));

  return (
    <section className={s.roomBoard} aria-label="회의실 예약 현황">
      <div className={s.roomBoardHead}>
        <h2>회의실 예약 현황</h2>
        <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
      </div>
      <div className={s.roomScale} aria-hidden="true">
        <span>{String(HOUR_START).padStart(2, "0")}:00</span>
        <span>{HOUR_END}:00</span>
      </div>
      {error && <p className={s.error}>예약 현황을 불러오지 못했습니다: {error}</p>}
      {rooms.length === 0 && (
        <p className={s.hint}>등록된 회의실이 없습니다. 회의실은 관리자가 넣습니다 (시드 데이터).</p>
      )}
      <ul className={s.roomList}>
        {rooms.map((r) => {
          const slots = busy[r.id] ?? [];
          return (
            <li key={r.id}>
              <span className={s.roomName}>{r.name}</span>
              <div className={s.roomTrack}>
                {slots.map((b) => (
                  <span
                    key={b.starts_at}
                    className={s.roomSlot}
                    style={{
                      left: `${pct(b.starts_at)}%`,
                      width: `${Math.max(1, pct(b.ends_at) - pct(b.starts_at))}%`,
                    }}
                    title={`${formatKstTime(b.starts_at)}~${formatKstTime(b.ends_at)} 예약됨`}
                  />
                ))}
              </div>
              <span className={s.roomText}>
                {slots.length === 0
                  ? "예약 없음"
                  : slots
                      .map((b) => `${formatKstTime(b.starts_at)}~${formatKstTime(b.ends_at)}`)
                      .join(", ")}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
