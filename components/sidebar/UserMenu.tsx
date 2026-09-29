"use client";

// ② 헤더 오른쪽 끝의 내 이름·나가기 (로그인 작업에서 로그아웃이 된다)

import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import s from "./sidebar.module.css";

export default function UserMenu() {
  const { me, signOut } = useWorkspace();
  return (
    <span className={s.userMenu}>
      <span className={s.me}>{me.name}</span>
      <button className="link" onClick={signOut}>
        나가기
      </button>
    </span>
  );
}
