"use client";

// ② 라이트·다크 스위치. 해·달 두 칸이 늘 보이고, 누른 쪽 테마가 적용된다.
// 어느 칸이 켜져 보일지는 CSS 가 <html data-theme>·컴퓨터 설정을 보고 정한다 — 서버에서 그린 첫 화면부터 맞아서 깜빡이지 않는다.
// 헤더(UserMenu)·캘린더·로그인 화면에서 같이 쓴다.

import { useSyncExternalStore } from "react";
import { currentTheme, setTheme, subscribeTheme, type Theme } from "./theme";
import s from "./sidebar.module.css";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

export default function ThemeToggle() {
  // 서버에서 그릴 때는 모르므로 null (aria-checked 만 비워 두고, 모양은 CSS 가 이미 맞게 그린다)
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => null);

  const option = (value: Theme, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={theme === null ? undefined : theme === value}
      aria-label={label}
      title={label}
      className={value === "light" ? s.themeLight : s.themeDark}
      onClick={() => setTheme(value)}
    >
      {icon}
    </button>
  );

  return (
    <span className={s.themeSwitch} role="radiogroup" aria-label="화면 테마">
      {option("light", "라이트 모드", <SunIcon />)}
      {option("dark", "다크 모드", <MoonIcon />)}
    </span>
  );
}
