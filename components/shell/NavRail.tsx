"use client";

// 공통 틀의 왼쪽 메뉴: 홈 · 메시지 · 일정 · 회의실 예약 · 조직도(/org 페이지) | 알림 · 설정 | 내 카드.
// 채널·DM 목록은 여기 두지 않는다 — 채팅 화면의 메시지 목록 칸(MessageNav)에만 있다 (목록이 두 번 보이지 않게).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import WorkOnLogo from "@/components/brand/WorkOnLogo";
import { openNotifications, useBellUnread } from "@/components/notifications/bellStore";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { useMyProfile } from "@/components/profile/profileSource";
import MyMenu, { useMenuDismiss } from "@/components/sidebar/MyMenu";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { BellIcon, CalendarIcon, ChatIcon, HomeIcon, OrgIcon, RoomIcon } from "./icons";
import { useUnreadTotals } from "./useUnreadTotals";
import s from "./shell.module.css";

function Badge({ n, tone }: { n: number; tone?: "bad" }) {
  if (n <= 0) return null;
  return (
    <span className={`${s.navBadge} ${tone === "bad" ? s.navBadgeBad : ""}`} aria-hidden="true">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Item({
  href,
  onClick,
  icon,
  label,
  active,
  badge,
  className,
}: {
  href?: string;
  onClick?: () => void;
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      <span className={s.navIcon}>{icon}</span>
      <span className={s.navLabel}>{label}</span>
      {badge}
    </>
  );
  const cls = `${s.navItem} ${active ? s.navActive : ""}`;
  return (
    <li className={className}>
      {href ? (
        <Link href={href} className={cls} aria-current={active ? "page" : undefined}>
          {inner}
        </Link>
      ) : (
        <button type="button" className={cls} onClick={onClick}>
          {inner}
        </button>
      )}
    </li>
  );
}

export default function NavRail() {
  const path = usePathname();
  const { me } = useWorkspace();
  const { profile } = useMyProfile();
  const unread = useUnreadTotals();
  const bell = useBellUnread();
  const name = profile?.display_name ?? me.name;

  // 맨 아래 내 카드를 누르면 위 막대의 내 이름과 같은 내 메뉴가 카드 바로 위에 열린다 (2026-09-30 사용자 요청 —
  // 예전에는 내 프로필 패널을 바로 열었다. 패널은 메뉴의 "내 프로필"로 연다)
  const [menuOpen, setMenuOpen] = useState(false);
  const meBox = useRef<HTMLDivElement>(null);
  const meButton = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useMenuDismiss(menuOpen, closeMenu, meBox, meButton);

  return (
    <nav className={s.nav} aria-label="메뉴">
      <Link href="/" className={s.brand} aria-label="WorkOn 홈">
        <WorkOnLogo height={32} />
      </Link>
      {/* 홈 · 메시지 · 일정 · 회의실 예약 | 구분선 | 조직도 · 알림 (2026-09-30 사용자 결정 — "설정"은 뺐다. 내 프로필은 맨 아래 내 카드 메뉴로) */}
      <ul className={s.navList}>
        <Item href="/" icon={<HomeIcon />} label="홈" active={path === "/"} className={s.navHome} />
        <Item
          href="/chat"
          icon={<ChatIcon />}
          label="메시지"
          active={path === "/chat"}
          badge={<Badge n={unread.total} />}
        />
        <Item href="/calendar" icon={<CalendarIcon />} label="일정" active={path === "/calendar"} />
        <Item href="/calendar#rooms" icon={<RoomIcon />} label="회의실 예약" className={s.navWide} />
      </ul>
      <ul className={`${s.navList} ${s.navGroup}`}>
        <Item href="/org" icon={<OrgIcon />} label="조직도" active={path === "/org"} className={s.navWide} />
        <Item onClick={openNotifications} icon={<BellIcon />} label="알림" badge={<Badge n={bell} tone="bad" />} />
      </ul>
      <div className={s.meBox} ref={meBox}>
        {menuOpen && <MyMenu id={menuId} onClose={closeMenu} className={s.meMenu} />}
        <button
          type="button"
          ref={meButton}
          className={s.meCard}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={`${name} — 내 메뉴`}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <PersonAvatar userId={profile?.id ?? null} name={name} size={40} />
          <span className={s.meText}>
            <strong>{name}</strong>
            <span>{profile?.department ?? "소속 없음"}</span>
          </span>
        </button>
      </div>
    </nav>
  );
}
