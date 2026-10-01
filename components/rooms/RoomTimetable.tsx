"use client";

// ② 통합 시간표 — 회의실 × 30분 칸 (08~21시). 지난 칸은 빗금, 지금 시각은 빨간 선.
// 빈 칸을 누르면 예약 패널이 열리고(1시간), 패널이 열린 채 같은 줄의 다른 칸을 누르면 거기까지 늘리거나 줄인다 (RoomsView 가 정한다).
// 예약 칸: 내 예약은 제목, 남의 공개 회의는 예약자 이름·부서, 비공개 회의는 "비공개 예약" (DB room_board 가 준 만큼만).

import { useEffect, useRef } from "react";
import type { Room, RoomBooking } from "@/lib/types/calendar";
import { kstMinuteOfDay, toMs } from "@/components/calendar/time";
import { ROOM_POLICY, SLOTS, hm } from "./policy";
import { bookerText } from "./status";
import s from "./rooms.module.css";

const NAME_COL = 128;

export type Selection = { roomId: string; start: number; end: number };

export default function RoomTimetable({
  rooms,
  board,
  date,
  today,
  now,
  lastDay,
  selection,
  skipEventId,
  focusRoom,
  focusEvent,
  onCell,
  onBooking,
}: {
  rooms: Room[];
  board: RoomBooking[];
  date: string;
  today: string;
  now: number;
  lastDay: string;
  /** 예약 패널에서 고른 칸 (그 날짜일 때만) */
  selection: Selection | null;
  /** 고치는 중인 내 예약 — 그 자리는 빈 칸으로 보인다 */
  skipEventId: string | null;
  focusRoom: string | null;
  focusEvent: string | null;
  onCell: (roomId: string, start: number) => void;
  onBooking: (b: RoomBooking) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const nowMin = kstMinuteOfDay(new Date(now));
  const nowSlot = Math.floor(nowMin / ROOM_POLICY.slot) * ROOM_POLICY.slot;
  const span = ROOM_POLICY.close - ROOM_POLICY.open;
  const showNow = date === today && nowMin >= ROOM_POLICY.open && nowMin < ROOM_POLICY.close;
  const closed = date < today || date > lastDay;

  // 고른 칸(없으면 지금 시각)이 보이게 가로로 민다 — 오른쪽 패널이 열려 본문이 좁을 때.
  // 날짜나 고른 칸이 바뀔 때만 민다 (30초마다 지금 시각이 바뀌어도 사용자가 밀어 둔 자리를 두게)
  const selStart = selection?.start ?? null;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const cur = kstMinuteOfDay(new Date());
    const target = selStart ?? (date === today && cur >= ROOM_POLICY.open && cur < ROOM_POLICY.close ? cur : ROOM_POLICY.open + 60);
    const cell = (el.scrollWidth - NAME_COL) / SLOTS;
    const x = ((target - ROOM_POLICY.open) / ROOM_POLICY.slot) * cell;
    const visible = x >= el.scrollLeft && x + cell * 2 <= el.scrollLeft + el.clientWidth - NAME_COL;
    if (!visible) el.scrollLeft = Math.max(0, x - cell * 2);
  }, [selStart, date, today]);

  const nowPct = ((nowMin - ROOM_POLICY.open) / span) * 100;
  const hours = Array.from({ length: span / 60 }, (_, i) => ROOM_POLICY.open / 60 + i);

  return (
    <div className={s.tt}>
      <div className={s.ttScroll} ref={scroller}>
        <div className={s.ttInner}>
          <div className={`${s.ttRow} ${s.ttHead}`}>
            <div className={s.ttName}>회의실</div>
            <div className={s.track} aria-hidden="true">
              {hours.map((h, i) => (
                <span key={h} className={s.hour} style={{ gridColumn: `${i * 2 + 1} / span 2` }}>
                  {String(h).padStart(2, "0")}
                </span>
              ))}
              {showNow && (
                <span className={s.nowTag} style={{ left: `${nowPct}%` }}>
                  {hm(nowMin)}
                </span>
              )}
            </div>
          </div>
          {rooms.map((room) => {
            const list = board.filter((b) => b.room_id === room.id && !(skipEventId && b.event_id === skipEventId));
            const busyAt = (m: number) =>
              list.some((b) => toMs(b.starts_at) < toMs(b.ends_at) && kstMinuteOfDay(b.starts_at) <= m && m < (kstMinuteOfDay(b.ends_at) || 24 * 60));
            const sel = selection && selection.roomId === room.id ? selection : null;
            return (
              <div key={room.id} className={`${s.ttRow} ${focusRoom === room.id ? s.focus : ""}`}>
                <div className={s.ttName}>
                  <strong>{room.name}</strong>
                  <span>
                    {room.capacity ? `${room.capacity}명` : ""}
                    {room.location ? ` · ${room.location}` : ""}
                  </span>
                </div>
                <div className={s.track}>
                  {Array.from({ length: SLOTS }, (_, i) => {
                    const m = ROOM_POLICY.open + i * ROOM_POLICY.slot;
                    if (busyAt(m)) return null;
                    const past = closed || (date === today && m < nowSlot);
                    const inSel = !!sel && m >= sel.start && m < sel.end;
                    const cls = [s.cell, i % 2 === 0 ? s.onHour : "", inSel ? s.sel : "", inSel && m === sel!.start ? s.first : "", inSel && m + ROOM_POLICY.slot === sel!.end ? s.last : ""].join(" ");
                    return (
                      <button
                        key={m}
                        type="button"
                        className={cls}
                        style={{ gridColumn: i + 1 }}
                        disabled={past}
                        aria-label={`${room.name} ${hm(m)} ${past ? "예약할 수 없음" : inSel ? "선택됨" : "비어 있음"}`}
                        aria-pressed={inSel}
                        onClick={() => onCell(room.id, m)}
                      />
                    );
                  })}
                  {list.map((b) => {
                    const a = Math.max(0, (kstMinuteOfDay(b.starts_at) - ROOM_POLICY.open) / ROOM_POLICY.slot);
                    const endMin = kstMinuteOfDay(b.ends_at) || 24 * 60;
                    const z = Math.min(SLOTS, (endMin - ROOM_POLICY.open) / ROOM_POLICY.slot);
                    if (z <= a) return null;
                    const ended = toMs(b.ends_at) <= now;
                    const priv = !b.mine && !b.title && (b.is_private || !b.booker_name);
                    const cls = [s.blk, b.mine ? s.mine : "", priv ? s.priv : "", ended ? s.ended : "", focusEvent && b.event_id === focusEvent ? s.focused : ""].join(" ");
                    const time = `${hm(kstMinuteOfDay(b.starts_at))}~${hm(endMin)}`;
                    return (
                      <button
                        key={`${b.starts_at}-${b.room_id}`}
                        type="button"
                        className={cls}
                        style={{ gridColumn: `${Math.floor(a) + 1} / ${Math.ceil(z) + 1}` }}
                        title={`${time} ${bookerText(b)}`}
                        aria-label={`${room.name} ${time} ${b.mine ? `내 예약 ${b.title ?? ""}` : priv ? "비공개 예약" : bookerText(b)}`}
                        onClick={() => onBooking(b)}
                      >
                        <strong>{b.mine ? b.title : priv ? "비공개 예약" : b.title ?? b.booker_name}</strong>
                        <span>{b.mine ? (b.is_private ? "내 예약 · 비공개" : "내 예약") : priv ? time : b.title ? b.booker_name : (b.booker_unit ?? time)}</span>
                      </button>
                    );
                  })}
                  {showNow && <span className={s.nowLine} style={{ left: `${nowPct}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
