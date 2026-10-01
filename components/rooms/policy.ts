// ② 회의실 예약 정책 (2026-10-01 사용자 결정, WU-46). 막는 것은 DB 트리거 events_room_policy 이고
// (supabase/migrations/20261001170000_rooms_v2.sql 의 room_policy() 와 숫자가 같아야 한다), 화면은 미리 알려 주기만 한다.

import { addDaysKey } from "@/components/calendar/items";
import { kstDateKey, kstMinuteOfDay } from "@/components/calendar/time";

export const ROOM_POLICY = {
  slot: 30,
  minMinutes: 30,
  maxMinutes: 240,
  open: 8 * 60,
  close: 21 * 60,
  windowDays: 90,
} as const;

export const SLOTS = (ROOM_POLICY.close - ROOM_POLICY.open) / ROOM_POLICY.slot;

/** "HH:MM" ↔ 분 */
export const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
/** "1시간 30분" */
export const durationText = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ""}` : `${min}분`);

/** 오늘(한국 날짜)과 예약할 수 있는 마지막 날 */
export function bookingWindow(now = new Date()) {
  const today = kstDateKey(now);
  return { today, lastDay: addDaysKey(today, ROOM_POLICY.windowDays) };
}

/** 지금 들어 있는 30분 칸의 시작 (오늘이면 이 칸부터 예약된다) */
export const nowSlot = (now = new Date()) => Math.floor(kstMinuteOfDay(now) / ROOM_POLICY.slot) * ROOM_POLICY.slot;

export type Check = { level: "ok" | "bad" | "warn"; text: string };

/** 예약 전 확인 — DB 트리거와 같은 규칙 + 수용 인원 경고. lockStart: 진행 중인 예약 고치기 (시작은 그대로) */
export function checkBooking(input: {
  date: string;
  start: number;
  end: number;
  /** 겹치는 남의 예약 설명 ("14:00~15:00 윤재혁 님 예약") — 없으면 null */
  clash: string | null;
  /** 같은 시간 내 다른 회의실 예약 이름 — 없으면 null */
  double: string | null;
  people: number;
  capacity: number | null;
  admin: boolean;
  lockStart?: boolean;
  now?: Date;
}): Check[] {
  const p = ROOM_POLICY;
  const { today, lastDay } = bookingWindow(input.now);
  const len = input.end - input.start;
  const out: Check[] = [];
  if (len < p.minMinutes) out.push({ level: "bad", text: `예약은 ${p.minMinutes}분 이상입니다` });
  else if (len > p.maxMinutes && !input.admin) out.push({ level: "bad", text: `한 번에 최대 ${p.maxMinutes / 60}시간까지 예약할 수 있습니다 (지금 ${durationText(len)})` });
  else out.push({ level: "ok", text: `예약 길이 ${durationText(len)} (30분~4시간)` });
  if (input.start < p.open || input.end > p.close) out.push({ level: "bad", text: `운영 시간(${hm(p.open)}~${hm(p.close)}) 밖입니다` });
  else out.push({ level: "ok", text: `운영 시간 ${hm(p.open)}~${hm(p.close)} 안` });
  const past = input.date < today || (input.date === today && input.start < nowSlot(input.now) && !input.lockStart);
  if (input.date > lastDay) out.push({ level: "bad", text: `오늘부터 ${p.windowDays}일(${lastDay.slice(5).replace("-", "/")})까지만 예약할 수 있습니다` });
  else if (past) out.push({ level: "bad", text: "지난 시각은 예약할 수 없습니다 (지금 들어 있는 30분 칸부터)" });
  else out.push({ level: "ok", text: input.date === today ? "당일 예약" : `${p.windowDays}일 안 (${lastDay.slice(5).replace("-", "/")}까지)` });
  out.push(input.clash ? { level: "bad", text: `${input.clash}과 겹칩니다` } : { level: "ok", text: "다른 예약과 겹치지 않음" });
  out.push(
    input.double
      ? { level: "bad", text: `같은 시간에 ${input.double} 예약이 있습니다 (한 사람이 두 곳을 잡을 수 없음)` }
      : { level: "ok", text: "같은 시간에 내 다른 회의실 예약 없음" },
  );
  if (input.capacity) {
    out.push(
      input.people <= input.capacity
        ? { level: "ok", text: `참석 ${input.people}명 / 수용 ${input.capacity}명` }
        : { level: "warn", text: `참석 ${input.people}명이 수용 인원 ${input.capacity}명보다 많습니다 (예약은 됩니다)` },
    );
  }
  return out;
}
