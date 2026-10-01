"use client";

// 대시보드 회의실 현황 (2026-10-01 개편). 지금 이 순간의 상태만 칩으로 보여 준다 — 사용 가능·N분 후 예약·사용 중·운영 종료.
// 하루 전체 시간표와 날짜 고르기는 /rooms(② components/rooms) 몫이다. 회의실 8개를 room_board 한 번으로 받는다 (2026-10-01).
// 회의실이 늘어 최대 SHOWN 개만 보인다 (WU-47): 내 회의(오늘 내가 참석하는 회의가 잡힌 곳) → 사용 가능(오래 비는 순) → 곧 사용 → 사용 중 → 운영 종료.
// 위에 상태별 개수 요약. 내 회의는 예약자가 아니어도 참석자면 넣는다 — 요약 카드 "내 회의 예약"과 같은 기준.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Room, RoomBooking } from "@/lib/types/calendar";
import { roomBoard } from "@/components/calendar/source";
import { addDays, formatKstTime, kstDateKey, kstMinuteOfDay, startOfKstDay, toMs } from "@/components/calendar/time";
import { HOUR_END } from "@/components/calendar/TimeGrid";
import { RoomIcon } from "@/components/shell/icons";
import s from "./dashboard.module.css";

const SOON_MIN = 15; // 이 안에 예약이 시작하면 "곧 사용"
const RELOAD_MS = 5 * 60_000; // 남이 새로 잡은 예약을 받아 오는 간격 (탭이 보일 때만)
const TICK_MS = 30_000; // 상태(남은 분)를 다시 계산하는 간격
const SHOWN = 4; // 대시보드에 보이는 회의실 수 (아래 줄 회사 공지·최근 대화 칸과 높이를 맞춘다)

type Tone = "ok" | "warn" | "bad" | "idle";
/** until: 정렬용 — 사용 가능은 비어 있는 끝 시각(없으면 Infinity), 사용 중은 끝나는 시각 */
type RoomState = { tone: Tone; label: string; detail: string; until: number };

/** "14:00", 오늘이 아니면 "내일 00:00" (자정을 넘는 예약·종일 예약) */
const clock = (ms: number, now: number) => (kstDateKey(new Date(ms)) === kstDateKey(new Date(now)) ? "" : "내일 ") + formatKstTime(new Date(ms));

/** 지금 시각 기준 회의실 상태. 이어 붙은 예약은 하나로 보고 끝나는 시각을 알려 준다 */
function stateOf(slots: RoomBooking[], now: number): RoomState {
  const list = [...slots].sort((a, b) => toMs(a.starts_at) - toMs(b.starts_at));
  const cur = list.find((b) => toMs(b.starts_at) <= now && now < toMs(b.ends_at));
  if (cur) {
    let end = toMs(cur.ends_at);
    for (const b of list) if (toMs(b.starts_at) <= end && toMs(b.ends_at) > end) end = toMs(b.ends_at);
    return { tone: "bad", label: "사용 중", detail: `${clock(end, now)}까지`, until: end };
  }
  const next = list.find((b) => toMs(b.starts_at) > now);
  if (next) {
    const min = Math.ceil((toMs(next.starts_at) - now) / 60_000);
    if (min <= SOON_MIN) return { tone: "warn", label: `${min}분 후 예약`, detail: `${formatKstTime(next.starts_at)} 시작`, until: toMs(next.starts_at) };
    return { tone: "ok", label: "사용 가능", detail: `${formatKstTime(next.starts_at)}까지 비어 있음`, until: toMs(next.starts_at) };
  }
  if (kstMinuteOfDay(new Date(now)) >= HOUR_END * 60) return { tone: "idle", label: "운영 종료", detail: "오늘 예약 끝", until: 0 };
  return { tone: "ok", label: "사용 가능", detail: "오늘 남은 예약 없음", until: Infinity };
}

const RANK: Record<Tone, number> = { ok: 1, warn: 2, bad: 3, idle: 4 };
const SUMMARY: [Tone, string][] = [
  ["ok", "사용 가능"],
  ["warn", "곧 사용"],
  ["bad", "사용 중"],
  ["idle", "운영 종료"],
];

/** 오늘 내가 참석하는 회의의 회의실·시간 (대시보드가 내 일정에서 넘긴다) */
export type MyMeeting = { room_id: string; starts_at: string; ends_at: string };

type Row = { room: Room; st: RoomState; mine: MyMeeting | undefined };

/** 내 회의(지금·오늘 남은 것)가 있는 회의실 먼저, 그다음 상태 순. 사용 가능은 오래 비는 곳, 사용 중은 빨리 끝나는 곳부터 */
function order(a: Row, b: Row): number {
  if (!!a.mine !== !!b.mine) return a.mine ? -1 : 1;
  if (a.mine && b.mine) return toMs(a.mine.starts_at) - toMs(b.mine.starts_at);
  if (a.st.tone !== b.st.tone) return RANK[a.st.tone] - RANK[b.st.tone];
  if (a.st.until === b.st.until) return 0; // 둘 다 Infinity(예약 없음)일 때 NaN 이 나지 않게
  if (a.st.tone === "ok") return b.st.until > a.st.until ? 1 : -1;
  return a.st.until > b.st.until ? 1 : -1;
}

const CHIP: Record<Tone, string> = { ok: s.chipOk, warn: s.chipWarn, bad: s.chipBad, idle: s.chipIdle };

/** rooms 가 null 이면 아직 회의실 목록을 불러오는 중 */
export default function RoomStatus({ rooms, mine }: { rooms: Room[] | null; mine: MyMeeting[] }) {
  const [busy, setBusy] = useState<Record<string, RoomBooking[]> | null>(null);
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

  const rows: Row[] = busy
    ? (rooms ?? [])
        .map((room) => {
          const slots = busy[room.id] ?? [];
          return { room, st: stateOf(slots, now), mine: mine.find((m) => m.room_id === room.id && toMs(m.ends_at) > now) };
        })
        .sort(order)
    : [];
  const counts = { ok: 0, warn: 0, bad: 0, idle: 0 };
  for (const r of rows) counts[r.st.tone] += 1;

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
          <p className={s.roomSummary}>
            {SUMMARY.filter(([t]) => t !== "idle" || counts.idle > 0).map(([t, label]) => (
              <span key={t}>
                <i className={s[`dot_${t}`]} aria-hidden="true" />
                {label} {counts[t]}
              </span>
            ))}
          </p>
          <ul className={s.rooms}>
            {rows.slice(0, SHOWN).map(({ room: r, st, mine }) => (
              <li key={r.id}>
                <span className={s.roomName}>
                  <strong>
                    {r.name}
                    {mine && <em className={s.mineTag}>내 회의</em>}
                  </strong>
                  <span>
                    {mine
                      ? `${formatKstTime(mine.starts_at)}–${clock(toMs(mine.ends_at), now)}`
                      : [r.capacity ? `${r.capacity}명` : null, st.detail].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={`${s.chip} ${CHIP[st.tone]}`}>{st.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link href="/rooms" className={s.more}>
        회의실 {rooms?.length ? `${rooms.length}개 ` : ""}모두 보기 ›
      </Link>
    </section>
  );
}
