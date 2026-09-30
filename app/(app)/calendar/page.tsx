// ② 일정 (2026-09-30 개편 — 회의실 예약은 /rooms). 화면은 components/calendar/ 에 있다.

import { Suspense } from "react";
import CalendarView from "@/components/calendar/CalendarView";

export const metadata = { title: "일정 · WorkOn" };

export default function CalendarPage() {
  // ?e= 를 읽는 useSearchParams 는 Suspense 안에 있어야 한다
  return (
    <Suspense fallback={null}>
      <CalendarView />
    </Suspense>
  );
}
