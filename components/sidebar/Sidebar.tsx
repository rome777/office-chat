"use client";

// ② 왼쪽 칸. 채널 목록·채널 만들기·채널 찾기, 캘린더 링크. 미읽음 배지·DM 목록이 여기에 붙는다.

import Link from "next/link";
import ChannelList from "./ChannelList";
import s from "./sidebar.module.css";

export default function Sidebar() {
  return (
    <nav className={s.sidebar} aria-label="채널">
      <p className={s.brand}>오피스톡</p>
      <p className={s.section}>채널</p>
      {/* 왼쪽 칸은 좁은 화면에서도 숨겨질 뿐 늘 그려지므로, 여기서 "보던 채널에서 빠짐"을 처리한다 */}
      <ChannelList guardCurrent />
      <p className={s.section}>일정</p>
      <ul className={s.list}>
        <li>
          <Link href="/calendar" className={`${s.item} ${s.link}`}>
            캘린더
          </Link>
        </li>
      </ul>
    </nav>
  );
}
