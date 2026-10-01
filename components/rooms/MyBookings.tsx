"use client";

// ② 내 예약 (본문 아래 칸) — 내가 예약자인 회의실 일정. 다가오는 / 지난·취소. 누르면 오른쪽에 일정 상세 패널.
// 상태: 예정 → 진행 중 → 종료, 또는 취소됨 (시각과 canceled_at 으로 정한다 — 따로 저장하지 않는다)

import { useState } from "react";
import type { CalendarEvent, Room } from "@/lib/types/calendar";
import { dayLabel } from "@/components/calendar/EventLists";
import { formatKstTime, kstDateKey, toMs } from "@/components/calendar/time";
import { durationText } from "./policy";
import type { Tone } from "./status";
import s from "./rooms.module.css";

export function bookingStatus(e: CalendarEvent, now: number): { tone: Tone; label: string } {
  if (e.canceled_at) return { tone: "bad", label: "취소됨" };
  if (toMs(e.ends_at) <= now) return { tone: "idle", label: "종료" };
  if (toMs(e.starts_at) <= now) return { tone: "ok", label: "진행 중" };
  return { tone: "info", label: "예정" };
}

export default function MyBookings({
  events,
  rooms,
  now,
  current,
  error,
  onOpen,
}: {
  events: CalendarEvent[] | null;
  rooms: ReadonlyMap<string, Room>;
  now: number;
  /** 오른쪽 패널에 열린 일정 */
  current: string | null;
  error: string | null;
  onOpen: (e: CalendarEvent) => void;
}) {
  const [tab, setTab] = useState<"up" | "past">("up");
  const list = events ?? [];
  const up = list.filter((e) => !e.canceled_at && toMs(e.ends_at) > now);
  const past = list.filter((e) => e.canceled_at || toMs(e.ends_at) <= now).reverse();
  const shown = tab === "up" ? up : past;

  return (
    <section className={s.mine} aria-labelledby="my-bookings">
      <div className={s.mineHead}>
        <h2 id="my-bookings">내 예약</h2>
        <div role="tablist" aria-label="내 예약 구분">
          <button type="button" role="tab" id="my-tab-up" aria-controls="my-bookings-list" aria-selected={tab === "up"} onClick={() => setTab("up")}>
            다가오는 {up.length}
          </button>
          <button type="button" role="tab" id="my-tab-past" aria-controls="my-bookings-list" aria-selected={tab === "past"} onClick={() => setTab("past")}>
            지난 · 취소 {past.length}
          </button>
        </div>
      </div>
      <div className={s.mineBody} role="tabpanel" id="my-bookings-list" aria-labelledby={tab === "up" ? "my-tab-up" : "my-tab-past"}>
        {error && <p className={s.empty}>내 예약을 불러오지 못했습니다: {error}</p>}
        {!error && events === null && <p className={s.empty}>불러오는 중…</p>}
        {!error && events !== null && shown.length === 0 && (
          <p className={s.empty}>{tab === "up" ? "다가오는 예약이 없습니다. 시간표의 빈 칸을 눌러 예약해 보세요." : "지난 30일 동안의 예약이 없습니다."}</p>
        )}
        {shown.map((e) => {
          const st = bookingStatus(e, now);
          const room = e.room_id ? rooms.get(e.room_id) : undefined;
          const len = Math.round((toMs(e.ends_at) - toMs(e.starts_at)) / 60000);
          return (
            <button key={e.id} type="button" className={`${s.mineRow} ${e.canceled_at ? s.canceled : ""} ${current === e.id ? s.current : ""}`} onClick={() => onOpen(e)}>
              <span className={s.mineWhen}>
                <strong>{dayLabel(kstDateKey(e.starts_at))}</strong>
                <span>
                  {formatKstTime(e.starts_at)}~{formatKstTime(e.ends_at)}
                </span>
              </span>
              <span className={s.mineWhat}>
                <span className={s.mineTitle}>{e.title}</span>
                <span className={s.mineSub}>
                  <span>{room?.name ?? "회의실"}</span>
                  <span>{durationText(len)}</span>
                  {e.visibility !== "public" && <span>비공개</span>}
                  {e.recurrence && <span>반복</span>}
                </span>
              </span>
              <span className={`${s.chip} ${s[st.tone]}`}>{st.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
