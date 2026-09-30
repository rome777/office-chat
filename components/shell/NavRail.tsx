"use client";

// 공통 틀의 왼쪽 메뉴: 홈 · 메시지 · 일정 · 회의실 예약 | 알림 · 조직도(/org 페이지) · 설정 | 내 카드.
// 채널·DM 목록은 여기 두지 않는다 — 채팅 화면의 메시지 목록 칸(MessageNav)에만 있다 (목록이 두 번 보이지 않게).

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { openNotifications, useBellUnread } from "@/components/notifications/bellStore";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { useMyProfile } from "@/components/profile/profileSource";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { BellIcon, CalendarIcon, ChatIcon, HomeIcon, OrgIcon, RoomIcon, SettingsIcon } from "./icons";
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
  const { me, panel, openPanel, closePanel } = useWorkspace();
  const { profile } = useMyProfile();
  const unread = useUnreadTotals();
  const bell = useBellUnread();
  const togglePanel = (kind: "profile") => (panel?.kind === kind ? closePanel() : openPanel({ kind }));
  const name = profile?.display_name ?? me.name;

  return (
    <nav className={s.nav} aria-label="메뉴">
      <Link href="/" className={s.brand}>
        <span className={s.logo} aria-hidden="true">
          <ChatIcon size={20} />
        </span>
        오피스톡
      </Link>
      <p className={s.navSection}>WORKSPACE</p>
      <ul className={s.navList}>
        <Item href="/" icon={<HomeIcon />} label="홈" active={path === "/"} />
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
        <Item onClick={openNotifications} icon={<BellIcon />} label="알림" badge={<Badge n={bell} tone="bad" />} />
        <Item href="/org" icon={<OrgIcon />} label="조직도" active={path === "/org"} className={s.navWide} />
        <Item onClick={() => togglePanel("profile")} icon={<SettingsIcon />} label="설정" active={panel?.kind === "profile"} />
      </ul>
      <button type="button" className={s.meCard} onClick={() => togglePanel("profile")} aria-label={`${name} — 내 프로필`}>
        <PersonAvatar userId={profile?.id ?? null} name={name} size={40} />
        <span className={s.meText}>
          <strong>{name}</strong>
          <span>{profile?.department ?? "소속 없음"}</span>
        </span>
      </button>
    </nav>
  );
}
