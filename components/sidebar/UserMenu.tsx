"use client";

// ② 헤더 오른쪽 끝의 테마 버튼과 내 이름. 내 이름을 누르면 내 메뉴(MyMenu)가 열린다:
// 상태 빠르게 바꾸기(오프라인으로 표시 포함) · 내 프로필(오른쪽 패널) · 로그아웃.
// 왼쪽 메뉴 맨 아래 내 카드(shell/NavRail)도 같은 메뉴를 연다

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Avatar from "@/components/profile/Avatar";
import { setMyPresence } from "@/components/profile/presence";
import { STATUS_LABEL, useMyProfile } from "@/components/profile/profileSource";
import p from "@/components/profile/profile.module.css";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import MyMenu, { useMenuDismiss } from "./MyMenu";
import ThemeToggle from "./ThemeToggle";
import s from "./sidebar.module.css";

export default function UserMenu() {
  const { me } = useWorkspace();
  const { profile } = useMyProfile();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close, box, opener);

  const name = profile?.display_name ?? me.name;
  const status = profile?.status ?? "online";

  // 헤더는 늘 떠 있으므로 여기서 회사 접속자 채널에 내 상태를 보낸다 (남의 상태 점은 이 채널로 본다, profile/presence)
  const loaded = !!profile;
  useEffect(() => {
    if (loaded) setMyPresence(status);
  }, [loaded, status]);

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
      {open && <MyMenu id={menuId} onClose={close} />}
    </span>
  );
}
