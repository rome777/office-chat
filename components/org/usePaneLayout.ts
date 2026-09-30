"use client";

// ③ 조직도의 오른쪽 목록 칸 폭과 접힘. 이 브라우저에만 기억한다 (사람마다 편한 폭이 달라서, 2026-09-30).
// localStorage 는 막혀 있을 수 있으므로(사생활 보호 창 등) 읽기·쓰기를 모두 감싼다. 못 읽으면 기본값.

import { useCallback, useEffect, useState } from "react";

const KEY = "office-chat:org-pane";
export const TREE_MIN = 260;

/** 처음 폭: 화면 폭의 22%, 280~380px (예전 clamp 와 같다) */
export const defaultTreeWidth = () =>
  typeof window === "undefined" ? 320 : Math.round(Math.min(380, Math.max(280, window.innerWidth * 0.22)));

type Saved = { width: number; open: boolean };

function read(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Saved>;
    return { width: typeof v.width === "number" ? v.width : defaultTreeWidth(), open: v.open !== false };
  } catch {
    return null;
  }
}

export function usePaneLayout() {
  // 서버에서 그린 첫 화면과 맞추려고 기본값으로 시작하고, 붙은 뒤 기억한 값을 읽는다
  const [width, setWidth] = useState(320);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const saved = read();
    setWidth(saved?.width ?? defaultTreeWidth());
    setOpen(saved?.open ?? true);
  }, []);

  const save = useCallback((next: Saved) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // 기억하지 못해도 지금 화면은 그대로 쓴다
    }
  }, []);

  const resize = useCallback(
    (w: number, max: number) => {
      const clamped = Math.round(Math.max(TREE_MIN, Math.min(max, w)));
      setWidth(clamped);
      save({ width: clamped, open: true });
    },
    [save],
  );

  const toggle = useCallback(() => {
    setOpen((o) => {
      save({ width, open: !o });
      return !o;
    });
  }, [save, width]);

  const reset = useCallback(() => {
    const w = defaultTreeWidth();
    setWidth(w);
    save({ width: w, open: true });
  }, [save]);

  return { width, open, resize, toggle, reset };
}
