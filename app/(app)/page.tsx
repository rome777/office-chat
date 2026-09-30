// 로그인 뒤 첫 화면 = 대시보드 (2026-09-30, WU-35). 화면은 components/dashboard/ 에 있다.

import { Suspense } from "react";
import Dashboard from "@/components/dashboard/Dashboard";

export default function HomePage() {
  // 예전 주소(/?m=)를 /chat 으로 넘기는 useSearchParams 는 Suspense 안에 있어야 한다
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
