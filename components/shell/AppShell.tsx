"use client";

// 공통 틀의 배치: 왼쪽 메뉴 | 위 막대(검색·알림·내 메뉴) | 가운데(페이지) | 오른쪽 패널(③).
// 좁은 화면(768px 미만)에서는 메뉴가 아래 탭 막대가 되고, 오른쪽 패널은 화면을 덮는다.

import type { ReactNode } from "react";
import NotificationBell from "@/components/notifications/NotificationBell"; // ③
import RightPanel from "@/components/panel/RightPanel"; // ③
import SearchBox from "@/components/search/SearchBox"; // ②
import UserMenu from "@/components/sidebar/UserMenu"; // ②
import NavRail from "./NavRail";
import ProfileCardHost from "./ProfileCard";
import s from "./shell.module.css";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={s.shell}>
      <NavRail />
      <header className={s.top}>
        <div className={s.search}>
          <SearchBox />
        </div>
        <div className={s.topRight}>
          <NotificationBell />
          <UserMenu />
        </div>
      </header>
      <main className={s.main}>{children}</main>
      <div className={s.panelSlot}>
        <RightPanel />
      </div>
      <ProfileCardHost />
    </div>
  );
}
