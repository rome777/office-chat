"use client";

// ② 회의실 카드 — 지금 상태 칩, 다음 예약(시각 · 예약자), 수용 인원, 층, 시설 아이콘, [시간표] [지금 사용] [예약하기].
// 사진 자리는 회의실 배치 그림(탁자와 의자 수)으로 대신한다. 한 줄 최대 4개, 버튼 줄은 카드 맨 아래.

import type { ReactNode } from "react";
import type { Room, RoomBooking } from "@/lib/types/calendar";
import { formatKstTime } from "@/components/calendar/time";
import cal from "@/components/calendar/schedule.module.css";
import { RoomGlyph, facilityLabel } from "./facilities";
import { nowSlot } from "./policy";
import { bookerText, roomState } from "./status";
import s from "./rooms.module.css";

const TINTS = ["var(--brand-soft)", "var(--ok-soft)", "var(--info-soft)", "var(--warn-soft)", "var(--idle-soft)"];

/** 탁자 하나와 의자(인원만큼, 그림은 14개까지). 모니터·프로젝터가 있으면 위에 화면 */
function Plan({ room }: { room: Room }) {
  const w = 220;
  const h = 96;
  const cap = room.capacity ?? 4;
  const n = Math.min(cap, 14);
  const tw = Math.min(150, 40 + n * 8);
  const th = cap > 12 ? 32 : 24;
  const tx = (w - tw) / 2;
  const ty = (h - th) / 2 + 4;
  const rows: [number, number][] = cap <= 2 ? [[1, ty - 13], [1, ty + th + 4]] : [[Math.ceil(n / 2), ty - 13], [n - Math.ceil(n / 2), ty + th + 4]];
  const screen = room.facilities.includes("monitor") || room.facilities.includes("projector");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {screen && <rect x={w / 2 - 22} y={6} width={44} height={4} rx={2} fill="var(--idle)" />}
      <rect x={tx} y={ty} width={tw} height={th} rx={8} fill="var(--surface)" stroke="var(--idle)" strokeWidth={1.2} />
      {rows.flatMap(([cnt, y], r) =>
        Array.from({ length: cnt }, (_, i) => (
          <rect key={`${r}-${i}`} x={tx + (tw / (cnt + 1)) * (i + 1) - 6} y={y} width={12} height={9} rx={3} fill="var(--surface)" stroke="var(--idle)" strokeWidth={1.2} />
        )),
      )}
    </svg>
  );
}

export default function RoomCards({
  rooms,
  floors,
  board,
  date,
  today,
  now,
  canBook,
  pickedRoom,
  nextFree,
  onBook,
  onTimetable,
}: {
  rooms: Room[];
  floors: string[];
  board: RoomBooking[];
  date: string;
  today: string;
  now: number;
  /** 그날 예약할 수 있나 (지난 날·90일 뒤면 아니다) */
  canBook: boolean;
  /** 예약 패널에서 고른 회의실 */
  pickedRoom: string | null;
  /** 지금(오늘이면 지금 칸부터) 처음 비는 시작 분, 없으면 null */
  nextFree: (roomId: string) => number | null;
  onBook: (roomId: string, now?: boolean) => void;
  onTimetable: (roomId: string) => void;
}) {
  return (
    <div className={s.cards}>
      {rooms.map((room) => {
        const list = board.filter((b) => b.room_id === room.id);
        const st = roomState(list, date, today, now);
        const free = canBook ? nextFree(room.id) : null;
        const nowSlotFree = date === today && !st.current && free === nowSlot(new Date(now));
        let next: ReactNode;
        if (date === today && st.current) {
          next = (
            <>
              지금 <strong>{bookerText(st.current)}</strong> · {formatKstTime(st.current.starts_at)}~{formatKstTime(st.current.ends_at)}
            </>
          );
        } else if (date === today && st.next) {
          next = (
            <>
              다음 예약 <strong>{formatKstTime(st.next.starts_at)}</strong> · {bookerText(st.next)}
              <br />
              {st.detail}
            </>
          );
        } else next = st.detail;
        return (
          <article key={room.id} className={`${s.card} ${pickedRoom === room.id ? s.picked : ""}`} aria-label={room.name}>
            <div className={s.plan} style={{ ["--tint" as string]: TINTS[Math.max(0, floors.indexOf(room.location ?? "기타")) % TINTS.length] }}>
              <Plan room={room} />
              <span className={`${s.chip} ${s[st.tone]} ${s.planChip}`}>{st.label}</span>
              {room.location && <span className={s.floor}>{room.location}</span>}
            </div>
            <div className={s.cardBody}>
              <div className={s.cardTitle}>
                <strong>{room.name}</strong>
                {room.capacity && (
                  <span className={s.cap}>
                    <RoomGlyph name="people" size={14} />
                    {room.capacity}명
                  </span>
                )}
              </div>
              <span className={s.loc}>
                <RoomGlyph name="pin" size={14} />
                {[room.location, room.description].filter(Boolean).join(" · ") || "위치 미정"}
              </span>
              <div className={s.facs} role="img" aria-label={`시설: ${room.facilities.map(facilityLabel).join(", ") || "없음"}`}>
                {room.facilities.map((f) => (
                  <span key={f} className={s.fac} title={facilityLabel(f)}>
                    <RoomGlyph name={f} />
                  </span>
                ))}
              </div>
              <div className={s.next}>{next}</div>
              <div className={s.cardActions}>
                <button type="button" className={cal.secondary} onClick={() => onTimetable(room.id)}>
                  시간표
                </button>
                {nowSlotFree && (
                  <button type="button" className={cal.secondary} onClick={() => onBook(room.id, true)}>
                    지금 사용
                  </button>
                )}
                <button type="button" className={cal.primary} disabled={free === null} onClick={() => onBook(room.id)}>
                  {!canBook ? "예약 불가" : free === null ? "빈 시간 없음" : "예약하기"}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
