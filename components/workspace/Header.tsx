// 공통 틀 — 헤더는 칸만 나눈다. 각 칸의 내용은 담당 영역의 컴포넌트가 그린다.
// 헤더에 새 항목이 필요하면 자기 컴포넌트 안에 넣고, 이 파일은 고치지 않는다.

import ConnectionStatus from "@/components/chat/ConnectionStatus"; // ①
import NotificationBell from "@/components/notifications/NotificationBell"; // ③
import HeaderActions from "@/components/panel/HeaderActions"; // ③
import SearchBox from "@/components/search/SearchBox"; // ②
import ChannelTitle from "@/components/sidebar/ChannelTitle"; // ②
import UserMenu from "@/components/sidebar/UserMenu"; // ②
import s from "./workspace.module.css";

export default function Header() {
  return (
    <header className={s.header}>
      <div className={s.headerLeft}>
        <ChannelTitle />
        <ConnectionStatus />
      </div>
      <div className={s.headerRight}>
        <SearchBox />
        <HeaderActions />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
