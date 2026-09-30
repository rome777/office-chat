"use client";

// ② 이메일 로그인 화면. 가입 탭은 2026-09-30 뺐다 — 가입 처리는 ./signUp.ts 에 따로 남겨 두었다 (지금은 쓰지 않음).
// 배치(2026-09-30 사용자가 시안 C 를 고름): 테마 스위치는 카드 오른쪽 위, 로고(38px)·카피는 가운데

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import WorkOnLogo from "@/components/brand/WorkOnLogo";
import ThemeToggle from "@/components/sidebar/ThemeToggle";
import { safeNext } from "./safeNext";
import s from "./auth.module.css";

const MIN_PASSWORD = 6; // Supabase 기본 최소 길이

export default function LoginForm({
  next,
  confirmFailed,
}: {
  next?: string;
  confirmFailed?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    // 가입 확인 링크(app/auth/callback)를 가입한 브라우저가 아닌 곳에서 열어도 여기로 온다. 메일 확인은 이미 끝났을 수 있다
    confirmFailed
      ? "확인 링크를 로그인으로 바꾸지 못했습니다. 메일 확인은 됐을 수 있으니 로그인해 보세요."
      : null,
  );

  const valid = email.trim().length > 0 && password.length >= MIN_PASSWORD;

  async function submit() {
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(signInMessage(error.message));
      setBusy(false);
      return;
    }
    // 쿠키가 담긴 채로 새로 불러와야 proxy.ts 가 로그인으로 본다
    window.location.assign(safeNext(next));
  }

  return (
    <main className={s.entry}>
      <form
        className={s.card}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) void submit();
        }}
      >
        <div className={s.themeCorner}>
          <ThemeToggle />
        </div>
        <div className={s.brandBlock}>
          <h1>
            <WorkOnLogo height={38} />
          </h1>
          <p className={s.slogan}>연결되면, 일이 시작됩니다.</p>
        </div>

        <input
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={!valid || busy}>
          {busy ? "잠시만요…" : "로그인"}
        </button>
      </form>
    </main>
  );
}

function signInMessage(raw: string): string {
  if (/invalid login credentials/i.test(raw)) return "이메일 또는 비밀번호가 맞지 않습니다.";
  if (/email not confirmed/i.test(raw)) return "메일의 확인 링크를 먼저 눌러 주세요.";
  return `로그인하지 못했습니다: ${raw}`;
}
