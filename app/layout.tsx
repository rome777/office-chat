import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "WorkOn",
  description: "사내 실시간 메신저",
};

// 사용자가 고른 라이트·다크 테마(② components/sidebar/theme.ts 가 쿠키에 적는다)를 서버에서 먼저 걸어 보낸다.
// 화면이 뜬 뒤 스크립트로 걸면 새로고침 순간 컴퓨터 설정 색이 잠깐 보인다 (깜빡임). 고르지 않았으면 붙이지 않는다
// components/sidebar/theme.ts 의 COOKIE 와 같아야 한다 (레이아웃 파일은 정해진 이름만 export 할 수 있다)
const THEME_COOKIE = "office-chat-theme";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    <html lang="ko" data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body>{children}</body>
    </html>
  );
}
