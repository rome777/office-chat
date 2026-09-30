"use client";

// ② 내 메뉴 — 상태 빠르게 바꾸기(오프라인으로 표시 포함) · 내 프로필(오른쪽 패널) · 로그아웃.
// 위 막대의 내 이름(UserMenu)과 왼쪽 메뉴 맨 아래 내 카드(shell/NavRail)가 같은 메뉴를 연다 (2026-09-30).
// 여는 버튼과 메뉴를 감싼 상자에 position: relative 를 두면 메뉴가 그 상자에 붙어 열린다.

import { useEffect, useState, type RefObject } from "react";
import type { Status } from "@/lib/types/profile";
import Avatar from "@/components/profile/Avatar";
import { STATUS_LABEL, updateMyProfile, useMyProfile } from "@/components/profile/profileSource";
import p from "@/components/profile/profile.module.css";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";

const MENU_STATUSES: Status[] = ["online", "away", "dnd", "invisible"];

/** 바깥을 누르거나 Esc 를 누르면 닫는다. Esc 로 닫으면 초점을 여는 버튼으로 돌려준다 */
export function useMenuDismiss(
  open: boolean,
  close: () => void,
  box: RefObject<HTMLElement | null>,
  opener: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      close();
      opener.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, box, opener]);
}

export default function MyMenu({ id, onClose, className }: { id: string; onClose: () => void; className?: string }) {
  const { me, signOut, openPanel } = useWorkspace();
  const { profile } = useMyProfile();
  const [error, setError] = useState<string | null>(null);
  const name = profile?.display_name ?? me.name;
  const status = profile?.status ?? "online";

  async function pick(next: Status) {
    setError(null);
    try {
      await updateMyProfile({ status: next });
      onClose();
    } catch (e) {
      setError(`바꾸지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div id={id} className={`${p.menu} ${className ?? ""}`} role="group" aria-label="내 메뉴">
      <div className={p.menuMe}>
        <Avatar name={name} avatar={profile?.avatar ?? null} size={32} />
        <span className={p.menuMeText}>
          <strong>{name}</strong>
          {profile && <span className={p.note}>{[profile.department, profile.title].filter(Boolean).join(" · ")}</span>}
        </span>
      </div>
      <p className={p.menuTitle}>상태 빠르게 바꾸기</p>
      {MENU_STATUSES.map((st) => (
        <button
          key={st}
          type="button"
          aria-pressed={status === st}
          className={p.menuItem}
          disabled={!profile}
          onClick={() => void pick(st)}
        >
          <span className={`${p.swatch} ${p[st]}`} aria-hidden="true" />
          {STATUS_LABEL[st]}
          {status === st && <span className={p.check} aria-hidden="true">✓</span>}
        </button>
      ))}
      {error && <p className={`${p.menuTitle} error-text`}>{error}</p>}
      <div className={p.menuSep} />
      <button
        type="button"
        className={p.menuItem}
        onClick={() => {
          openPanel({ kind: "profile" });
          onClose();
        }}
      >
        내 프로필
      </button>
      <div className={p.menuSep} />
      <button type="button" className={`${p.menuItem} ${p.danger}`} onClick={signOut}>
        로그아웃
      </button>
    </div>
  );
}
