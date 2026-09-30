// 조직도 (/org, 2026-09-30). ?unit=<조직 id>·?channel=<채널 id> 로 그 조직을 고른 채 연다. 화면은 components/org/.

import { Suspense } from "react";
import OrgPage from "@/components/org/OrgPage";

export const metadata = { title: "조직도 · 오피스톡" };

export default function Page() {
  // ?unit= 을 읽는 useSearchParams 는 Suspense 안에 있어야 한다
  return (
    <Suspense fallback={null}>
      <OrgPage />
    </Suspense>
  );
}
