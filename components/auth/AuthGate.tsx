"use client";

// ② 입장 관문. Supabase 로그인 세션이 있으면 채팅 화면을, 없으면 로그인 화면으로 보낸다.
// 바깥(app/page.tsx)은 children(me, signOut) 만 받으므로 이 파일 안만 바꾸면 된다.
// 로그인 안 한 요청은 proxy.ts 가 먼저 막고, 여기서는 탭을 연 채로 세션이 끝난 경우를 처리한다.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import type { Me } from "@/components/workspace/WorkspaceContext";
import { getSupabase } from "@/lib/supabase";

export default function AuthGate({
  children,
}: {
  children: (me: Me, signOut: () => void) => ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    // getSession 이 아니라 onAuthStateChange 의 첫 이벤트(INITIAL_SESSION)로 시작한다
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setUser(session.user);
      else goToLogin();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // local: 이 브라우저만 로그아웃한다 (같은 계정으로 연 다른 창·기기는 그대로).
  // 서버 요청이 실패해도 이 브라우저의 세션 쿠키는 지워진다
  const signOut = useCallback(() => {
    void getSupabase()
      .auth.signOut({ scope: "local" })
      .finally(goToLogin);
  }, []);

  const me = useMemo(() => (user ? { name: displayName(user) } : null), [user]);

  if (error) return <p className="muted">{error}</p>;
  if (!me) return null;
  return <>{children(me, signOut)}</>;
}

function goToLogin() {
  const here = window.location.pathname + window.location.search;
  window.location.assign(here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`);
}

// 가입 때 받은 표시 이름. 없으면 이메일 앞부분. 메시지 작성자 칸이 20자까지라 자른다
function displayName(user: User): string {
  const fromMeta = user.user_metadata?.display_name;
  const name =
    typeof fromMeta === "string" && fromMeta.trim() ? fromMeta.trim() : user.email?.split("@")[0];
  return (name || "이름 없음").slice(0, 20);
}
