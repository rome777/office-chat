"use client";

// ② 입장 관문. 지금은 닉네임, 로그인 작업에서 Supabase Auth 로 바꾼다.
// 바깥(app/page.tsx)은 children(me, signOut) 만 받으므로 이 파일 안만 바꾸면 된다.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Me } from "@/components/workspace/WorkspaceContext";
import NicknameForm from "./NicknameForm";

const NICKNAME_KEY = "office-chat:nickname";

export default function AuthGate({
  children,
}: {
  children: (me: Me, signOut: () => void) => ReactNode;
}) {
  const [nickname, setNickname] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setNickname(localStorage.getItem(NICKNAME_KEY));
    } catch {
      // 저장소를 못 쓰는 환경이면 매번 입력받는다
    }
    setReady(true);
  }, []);

  function enter(name: string) {
    try {
      localStorage.setItem(NICKNAME_KEY, name);
    } catch {}
    setNickname(name);
  }

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(NICKNAME_KEY);
    } catch {}
    setNickname(null);
  }, []);

  const me = useMemo(() => (nickname ? { name: nickname } : null), [nickname]);

  if (!ready) return null;
  return me ? <>{children(me, signOut)}</> : <NicknameForm onSubmit={enter} />;
}
