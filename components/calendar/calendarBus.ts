"use client";

// ② 일정 화면(가운데)과 일정 패널(오른쪽, 공통 틀의 RightPanel 안)을 잇는다.
//   바뀜(version): 패널에서 만들고·고치고·취소하고·답하면 올린다 → 캘린더가 다시 불러온다
//   보여 줄 날짜(focus): 패널에서 저장한 일정의 날짜로 캘린더를 옮긴다

import { useSyncExternalStore } from "react";

let version = 0;
let focus: { date: string; seq: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** 일정이 바뀌었다 (다시 불러오게) */
export function bumpCalendar() {
  version += 1;
  emit();
}

/** 캘린더를 그 날짜(한국 날짜 "YYYY-MM-DD")로 옮긴다 */
export function focusCalendarDate(date: string) {
  focus = { date, seq: (focus?.seq ?? 0) + 1 };
  emit();
}

export function useCalendarVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

export function useCalendarFocus(): { date: string; seq: number } | null {
  return useSyncExternalStore(subscribe, () => focus, () => null);
}
