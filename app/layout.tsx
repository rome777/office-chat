import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "오피스톡",
  description: "사내 실시간 메신저",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
