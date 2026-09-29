"use client";

// ② 라이트·다크 테마. 사용자가 고르면 쿠키에 기억하고(서버가 다음 요청부터 <html data-theme> 를 미리 걸어 깜빡임이 없다),
// 고르지 않았으면 컴퓨터 설정을 따른다. 색은 app/globals.css 가 data-theme 를 보고 바꾼다.
// 다른 탭에 알리려고 localStorage 에도 같은 값을 적는다 (쿠키는 바뀌어도 이벤트가 없다).

export type Theme = "light" | "dark";

/** app/layout.tsx 의 THEME_COOKIE 와 같아야 한다 (서버가 이 쿠키로 첫 화면의 테마를 정한다) */
const COOKIE = "office-chat-theme";
const KEY = "office-chat:theme";
const YEAR = 60 * 60 * 24 * 365;
const listeners = new Set<() => void>();
let started = false;

/** 고른 테마. 서버가 걸어 둔 <html data-theme> 가 기준이다 */
function chosen(): Theme | null {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : null;
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** 지금 보이는 테마 (고른 것, 없으면 컴퓨터 설정) */
export function currentTheme(): Theme {
  return chosen() ?? (systemDark() ? "dark" : "light");
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.cookie = `${COOKIE}=${t}; path=/; max-age=${YEAR}; samesite=lax`;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // 다른 탭 알림만 못 할 뿐, 쿠키로 기억은 된다
  }
  listeners.forEach((fn) => fn());
}

/** 테마가 바뀌면 알려 준다. 컴퓨터 설정이 바뀌거나 다른 탭에서 바꿔도 알려 준다 */
export function subscribeTheme(fn: () => void): () => void {
  if (!started) {
    started = true;
    const notify = () => listeners.forEach((l) => l());
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", notify);
    window.addEventListener("storage", (e) => {
      if (e.key !== KEY || (e.newValue !== "light" && e.newValue !== "dark")) return;
      document.documentElement.dataset.theme = e.newValue;
      notify();
    });
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}
