"use client";

// ② 라이트·다크 바꾸기 버튼. 라이트일 때는 🌙(누르면 다크), 다크일 때는 ☀️(누르면 라이트).
// 헤더(UserMenu)·캘린더·로그인 화면에서 같이 쓴다.

import { useSyncExternalStore } from "react";
import { currentTheme, setTheme, subscribeTheme } from "./theme";
import s from "./sidebar.module.css";

export default function ThemeToggle() {
  // 서버에서 그릴 때는 테마를 모르므로 null → 버튼 자리만 잡아 둔다 (화면이 뜬 뒤 바로 채워진다)
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => null);
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "다크 모드로 바꾸기" : "라이트 모드로 바꾸기";

  return (
    <button
      type="button"
      className={s.themeToggle}
      aria-label={label}
      title={label}
      disabled={theme === null}
      onClick={() => setTheme(next)}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
}
