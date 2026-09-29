"use client";

// ② 헤더 오른쪽 끝의 테마 버튼·내 이름·로그아웃

import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import ThemeToggle from "./ThemeToggle";
import s from "./sidebar.module.css";

export default function UserMenu() {
  const { me, signOut } = useWorkspace();
  return (
    <span className={s.userMenu}>
      <ThemeToggle />
      <span className={s.me}>{me.name}</span>
      <button className="link" onClick={signOut}>
        로그아웃
      </button>
    </span>
  );
}
