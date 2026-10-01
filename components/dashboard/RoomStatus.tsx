"use client";

// 대시보드 회의실 현황 (2026-10-01 개편). 지금 이 순간의 상태만 칩으로 보여 준다 — 사용 가능·N분 후 예약·사용 중·운영 종료.
// 하루 전체 시간표와 날짜 고르기는 /rooms(② components/rooms) 몫이다. 회의실 8개를 room_board 한 번으로 받는다 (2026-10-01).

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Room } from "@/lib/types/calendar";
import { roomBoard, type BusySlot } from "@/components/calendar/source";
import { addDays, formatKstTime, kstDateKey, kstMinuteOfDay, startOfKstDay, toMs } from "@/components/calendar/time";
import { HOUR_END } from "@/components/calendar/TimeGrid";
import { RoomIcon } from "@/components/shell/icons";
import s from "./dashboard.module.css";

const SOON_MIN = 15; // 이 안에 예약이 시작하면 "곧 사용"
const RELOAD_MS = 5 * 60_000; // 남이 새로 잡은 예약을 받아 오는 간격 (탭이 보일 때만)
const TICK_MS = 30_000; // 상태(남은 분)를 다시 계산하는 간격

type Tone = "ok" | "warn" | "bad" | "idle";
type RoomState = { tone: Tone; label: string; detail: string };

/** "14:00", 오늘이 아니면 "내일 00:00" (자정을 넘는 예약·종일 예약) */
const clock = (ms: number, now: number) => (kstDateKey(new Date(ms)) === kstDateKey(new Date(now)) ? "" : "내일 ") + formatKstTime(new Date(ms));

/** 지금 시각 기준 회의실 상태. 이어 붙은 예약은 하나로 보고 끝나는 시각을 알려 준다 */
function stateOf(slots: BusySlot[], now: number): RoomState {
  const list = [...slots].sort((a, b) => toMs(a.starts_at) - toMs(b.starts_at));
  const cur = list.find((b) => toMs(b.starts_at) <= now && now < toMs(b.ends_at));
  if (cur) {
    let end = toMs(cur.ends_at);
    for (const b of list) if (toMs(b.starts_at) <= end && toMs(b.ends_at) > end) end = toMs(b.ends_at);
    return { tone: "bad", label: "사용 중", detail: `${clock(end, now)}까지` };
  }
  const next = list.find((b) => toMs(b.starts_at) > now);
  if (next) {
    const min = Math.ceil((toMs(next.starts_at) - now) / 60_000);
    if (min <= SOON_MIN) return { tone: "warn", label: `${min}분 후 예약`, detail: `${formatKstTime(next.starts_at)} 시작` };
    return { tone: "ok", label: "사용 가능", detail: `${formatKstTime(next.starts_at)}까지 비어 있음` };
  }
  if (kstMinuteOfDay(new Date(now)) >= HOUR_END * 60) return { tone: "idle", label: "운영 종료", detail: "오늘 예약 끝" };
  return { tone: "ok", label: "사용 가능", detail: "오늘 남은 예약 없음" };
}

const CHIP: Record<Tone, string> = { ok: s.chipOk, warn: s.chipWarn, bad: s.chipBad, idle: s.chipIdle };

/** rooms 가 null 이면 아직 회의실 목록을 불러오는 중 */
export default function RoomStatus({ rooms }: { rooms: Room[] | null }) {
  const [busy, setBusy] = useState<Record<string, BusySlot[]> | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!rooms?.length) return;
    let alive = true;
    const load = () => {
      const from = startOfKstDay(new Date());
      const to = addDays(from, 1);
      void roomBoard(from, to).then(
        (rows) => {
          if (!alive) return;
          setBusy(Object.fromEntries(rooms.map((r) => [r.id, rows.filter((b) => b.room_id === r.id)])));
          setLoadedAt(Date.now());
          setNow(Date.now());
          setError(null);
        },
        (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
      );
    };
    const visible = () => document.visibilityState === "visible";
    const onVisible = () => visible() && load();
    load();
    const reload = setInterval(() => visible() && load(), RELOAD_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(reload);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [rooms]);

  return (
    <section className={s.box} aria-labelledby="dash-rooms">
      <div className={s.boxHead}>
        <h2 id="dash-rooms">
          <RoomIcon size={18} /> 회의실 현황
        </h2>
        {loadedAt && <span className={s.count}>{formatKstTime(new Date(loadedAt))} 기준</span>}
      </div>
      {rooms?.length === 0 ? (
        <p className={s.empty}>등록된 회의실이 없습니다.</p>
      ) : busy === null ? (
        <p className={s.empty}>{error ? `회의실 현황을 불러오지 못했습니다: ${error}` : "불러오는 중…"}</p>
      ) : (
        <>
          {/* 다시 불러오다 실패하면 받아 둔 목록은 두고 한 줄만 알린다 */}
          {error && <p className={s.empty}>새로 불러오지 못해 {loadedAt ? formatKstTime(new Date(loadedAt)) : ""} 기준으로 보여 줍니다.</p>}
          <ul className={s.rooms}>
            {(rooms ?? []).map((r) => {
              const st = stateOf(busy[r.id] ?? [], now);
              return (
                <li key={r.id}>
                  <span className={s.roomName}>
                    <strong>{r.name}</strong>
                    <span>{[r.capacity ? `${r.capacity}명` : null, st.detail].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={`${s.chip} ${CHIP[st.tone]}`}>{st.label}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Link href="/rooms" className={s.more}>
        회의실 전체 보기 ›
      </Link>
    </section>
  );
}
