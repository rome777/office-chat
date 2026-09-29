"use client";

// ② 왼쪽 칸. 채널 목록·미읽음 배지·채널 만들기·DM 목록이 여기에 붙는다.

import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import s from "./sidebar.module.css";

export default function Sidebar() {
  const { channel } = useWorkspace();
  return (
    <nav className={s.sidebar} aria-label="채널">
      <p className={s.brand}>오피스톡</p>
      <p className={s.section}>채널</p>
      <ul className={s.list}>
        <li>
          <span className={`${s.item} ${s.active}`} aria-current="page">
            # {channel.name}
          </span>
        </li>
      </ul>
    </nav>
  );
}
