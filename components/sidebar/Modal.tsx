"use client";

// ② 채널 만들기·찾기 대화상자의 바탕. 헤더 안의 채널 목록에서 열어도 화면 전체를 덮도록
// document.body 에 그린다. data-modal 이 붙은 곳을 누르면 헤더의 채널 목록이 닫히지 않는다.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import s from "./sidebar.module.css";

export default function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const pressedOnBackdrop = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    setMounted(true);
    // 닫히면 열기 전에 누르던 버튼으로 초점을 돌려준다
    const opener = document.activeElement as HTMLElement | null;
    // 초점이 어디에 있든 Esc 로 닫는다. preventDefault 로 헤더의 채널 목록이 같이 닫히지 않게 알린다
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className={s.backdrop}
      data-modal=""
      // 입력창을 끌어 선택하다 바깥에서 손을 떼도 닫히지 않게, 바탕에서 누르고 뗀 경우만 닫는다
      onMouseDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={s.modalBox}>{children}</div>
    </div>,
    document.body,
  );
}
