"use client";

// ② 시각 고르기 — 시(00~23)와 분(5분 단위, 회의실을 고르면 30분 단위 — step) 목록 두 개.
// 브라우저 기본 <input type="time"> 은 Chrome 에서 12 다음에 1 로 끝없이 도는 바퀴라(오전·오후도 헷갈린다)
// 한 번씩만 나오는 목록으로 바꿨다. 값은 "HH:MM" 그대로 주고받는다.

import s from "./schedule.module.css";

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const minutesBy = (step: number) => Array.from({ length: 60 / step }, (_, i) => String(i * step).padStart(2, "0"));

export default function TimeSelect({
  value,
  onChange,
  label,
  step = 5,
  disabled = false,
}: {
  /** "HH:MM" */
  value: string;
  onChange: (value: string) => void;
  /** 화면 낭독기용 (예: "시작") */
  label: string;
  /** 분 간격 (5 또는 30) */
  step?: number;
  disabled?: boolean;
}) {
  const [hh = "00", mm = "00"] = value.split(":");
  // 5분 단위가 아닌 시각(다른 곳에서 만든 회의)도 그대로 보이게 목록에 넣어 둔다
  const base = minutesBy(step);
  const minutes = base.includes(mm) ? base : [...base, mm].sort();

  return (
    <span className={s.timeSelect}>
      <select aria-label={`${label} 시`} disabled={disabled} value={hh} onChange={(e) => onChange(`${e.target.value}:${mm}`)}>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}시
          </option>
        ))}
      </select>
      <select aria-label={`${label} 분`} disabled={disabled} value={mm} onChange={(e) => onChange(`${hh}:${e.target.value}`)}>
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}분
          </option>
        ))}
      </select>
    </span>
  );
}

/** "HH:MM" → 0시부터 지난 분 */
export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** 0시부터 지난 분 → "HH:MM" */
export const fromMinutes = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
