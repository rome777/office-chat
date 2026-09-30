"use client";

// ② 헤더 오른쪽 끝의 테마 버튼과 내 이름. 내 이름을 누르면 메뉴가 열린다:
// 상태 빠르게 바꾸기(오프라인으로 표시 포함) · 내 프로필(오른쪽 패널) · 로그아웃

import { useEffect, useId, useRef, useState } from "react";
import type { Status } from "@/lib/types/profile";
import Avatar from "@/components/profile/Avatar";
import { setMyPresence } from "@/components/profile/presence";
import { STATUS_LABEL, updateMyProfile, useMyProfile } from "@/components/profile/profileSource";
import p from "@/components/profile/profile.module.css";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import ThemeToggle from "./ThemeToggle";
import s from "./sidebar.module.css";

const MENU_STATUSES: Status[] = ["online", "away", "dnd", "invisible"];

export default function UserMenu() {
  const { me, signOut, openPanel } = useWorkspace();
  const { profile } = useMyProfile();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // 바깥을 누르거나 Esc 를 누르면 닫는다 (ChannelTitle 과 같은 방식)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setOpen(false);
      opener.current?.focus(); // Esc 로 닫으면 초점을 내 이름 버튼으로 돌려준다
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = profile?.display_name ?? me.name;
  const status = profile?.status ?? "online";

  // 헤더는 늘 떠 있으므로 여기서 회사 접속자 채널에 내 상태를 보낸다 (남의 상태 점은 이 채널로 본다, profile/presence)
  const loaded = !!profile;
  useEffect(() => {
    if (loaded) setMyPresence(status);
  }, [loaded, status]);

  async function pick(next: Status) {
    setError(null);
    try {
      await updateMyProfile({ status: next });
      setOpen(false);
    } catch (e) {
      setError(`바꾸지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <span className={s.userMenu} ref={box}>
      <ThemeToggle />
      <button
        type="button"
        ref={opener}
        className={p.meButton}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${name} — ${STATUS_LABEL[status]}, 내 메뉴`}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={name} avatar={profile?.avatar ?? null} size={24} status={profile ? status : undefined} />
        <span className={s.me}>{name}</span>
        <span className={p.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div id={menuId} className={p.menu} role="group" aria-label="내 메뉴">
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
              setOpen(false);
            }}
          >
            내 프로필
          </button>
          <div className={p.menuSep} />
          <button type="button" className={`${p.menuItem} ${p.danger}`} onClick={signOut}>
            로그아웃
          </button>
        </div>
      )}
    </span>
  );
}
