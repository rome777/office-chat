"use client";

// ② 라이트·다크 테마. 사용자가 고르면 이 브라우저에 기억하고(localStorage), 고르지 않았으면 컴퓨터 설정을 따른다.
// 고른 테마는 <html data-theme="light|dark"> 로 걸고, 색은 app/globals.css 가 이 표시를 보고 바꾼다.

export type Theme = "light" | "dark";

const KEY = "office-chat:theme";
const listeners = new Set<() => void>();
let started = false;

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null; // 저장소를 못 쓰는 환경 (시크릿 창 설정 등)
  }
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** 지금 보이는 테마 (고른 것, 없으면 컴퓨터 설정) */
export function currentTheme(): Theme {
  return stored() ?? (systemDark() ? "dark" : "light");
}

function apply() {
  const t = stored();
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // 기억은 못 해도 지금 화면에는 적용한다
  }
  document.documentElement.dataset.theme = t;
  listeners.forEach((fn) => fn());
}

/** 테마가 바뀌면 알려 준다 (버튼 모양을 바꾸려고). 컴퓨터 설정이 바뀌어도 알려 준다 */
export function subscribeTheme(fn: () => void): () => void {
  if (!started) {
    started = true;
    apply();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
      listeners.forEach((l) => l()),
    );
    // 다른 탭에서 바꾸면 이 탭도 따라간다
    window.addEventListener("storage", (e) => {
      if (e.key !== KEY) return;
      apply();
      listeners.forEach((l) => l());
    });
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}
