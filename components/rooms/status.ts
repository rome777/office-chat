// ② 회의실 상태 계산 — 지금 상태(사용 가능·N분 후 예약·사용 중·운영 종료), 다음 예약, 예약자 글자.
// 대시보드 회의실 칩(③ dashboard/RoomStatus)과 같은 기준이다 (15분 안에 시작하면 "N분 후 예약").

import type { RoomBooking } from "@/lib/types/calendar";
import { formatKstTime, kstMinuteOfDay, toMs } from "@/components/calendar/time";
import { ROOM_POLICY, hm } from "./policy";

export type Tone = "ok" | "warn" | "bad" | "idle" | "info";
export type RoomState = { tone: Tone; label: string; detail: string; current: RoomBooking | null; next: RoomBooking | null };

const SOON_MIN = 15;

/** 시간표·카드에 보이는 예약자: 내 예약은 제목, 참석하는 회의는 제목 · 예약자, 남의 공개 회의는 이름 · 부서, 비공개는 숨김 */
export function bookerText(b: RoomBooking): string {
  if (b.mine) return b.title ?? "내 예약";
  if (b.title) return `${b.title} · ${b.booker_name ?? ""}`;
  if (b.is_private || !b.booker_name) return "비공개 예약";
  return `${b.booker_name}${b.booker_unit ? ` · ${b.booker_unit}` : ""}`;
}

/** 그날 가장 긴 빈 시간 (운영 시간 안) */
function longestGap(list: RoomBooking[]): string {
  let best: [number, number] = [0, 0];
  let from = ROOM_POLICY.open;
  for (const b of list) {
    const s = Math.max(ROOM_POLICY.open, kstMinuteOfDay(b.starts_at));
    if (s - from > best[1] - best[0]) best = [from, s];
    from = Math.max(from, Math.min(ROOM_POLICY.close, kstMinuteOfDay(b.ends_at) || ROOM_POLICY.close));
  }
  if (ROOM_POLICY.close - from > best[1] - best[0]) best = [from, ROOM_POLICY.close];
  return best[1] > best[0] ? `가장 긴 빈 시간 ${hm(best[0])}~${hm(best[1])}` : "빈 시간 없음";
}

/** list: 그 회의실의 그날 예약 (시작 순) */
export function roomState(list: RoomBooking[], date: string, today: string, now: number): RoomState {
  if (date < today) return { tone: "idle", label: "지난 날짜", detail: `예약 ${list.length}건`, current: null, next: null };
  if (date > today) {
    return { tone: list.length ? "info" : "ok", label: list.length ? `예약 ${list.length}건` : "예약 없음", detail: longestGap(list), current: null, next: list[0] ?? null };
  }
  const current = list.find((b) => toMs(b.starts_at) <= now && now < toMs(b.ends_at)) ?? null;
  const next = list.find((b) => toMs(b.starts_at) > now) ?? null;
  if (current) {
    // 이어 붙은 예약은 하나로 보고 끝나는 시각을 알려 준다
    let end = toMs(current.ends_at);
    for (const b of list) if (toMs(b.starts_at) <= end && toMs(b.ends_at) > end) end = toMs(b.ends_at);
    return { tone: "bad", label: "사용 중", detail: `${formatKstTime(new Date(end))}까지`, current, next };
  }
  if (kstMinuteOfDay(new Date(now)) >= ROOM_POLICY.close) return { tone: "idle", label: "운영 종료", detail: "오늘 예약 끝", current, next };
  if (next) {
    const min = Math.ceil((toMs(next.starts_at) - now) / 60000);
    if (min <= SOON_MIN) return { tone: "warn", label: `${min}분 후 예약`, detail: `${formatKstTime(next.starts_at)} 시작`, current, next };
    return { tone: "ok", label: "사용 가능", detail: `${formatKstTime(next.starts_at)}까지 비어 있음`, current, next };
  }
  return { tone: "ok", label: "사용 가능", detail: "오늘 남은 예약 없음", current, next };
}
