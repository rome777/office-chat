// ② 회의실 예약 (2026-10-01 개편 — 일정 화면과 같은 서브 메뉴·오른쪽 패널 틀). 화면은 components/rooms/RoomsView.

import { Suspense } from "react";
import RoomsView from "@/components/rooms/RoomsView";

export const metadata = { title: "회의실 예약 · WorkOn" };

export default function RoomsPage() {
  // ?new=1 · ?date= 를 읽는 useSearchParams 는 Suspense 안에 있어야 한다
  return (
    <Suspense fallback={null}>
      <RoomsView />
    </Suspense>
  );
}
