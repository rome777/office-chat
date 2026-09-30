// 공통 틀 — 로그인한 화면(대시보드 /, 채팅 /chat, 캘린더 /calendar)이 같은 틀(메뉴·상단 바·오른쪽 패널)을 쓴다.
// 이 파일은 고치지 않는다. 틀은 components/shell/ 에 있다.

import AppFrame from "@/components/shell/AppFrame";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
