// ② 회의실 예약 (2026-09-30 일정 개편에서 /calendar#rooms 를 옮김). 화면은 components/calendar/RoomsView.

import { Suspense } from "react";
import RoomsView from "@/components/calendar/RoomsView";

export const metadata = { title: "회의실 예약 · WorkOn" };

export default function RoomsPage() {
  // ?new=1 을 읽는 useSearchParams 는 Suspense 안에 있어야 한다
  return (
    <Suspense fallback={null}>
      <RoomsView />
    </Suspense>
  );
}
