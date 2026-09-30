"use client";

// ② 이메일 로그인·가입 화면

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import WorkOnLogo from "@/components/brand/WorkOnLogo";
import ThemeToggle from "@/components/sidebar/ThemeToggle";
import { safeNext } from "./safeNext";
import s from "./auth.module.css";

type Mode = "signIn" | "signUp";

const MIN_PASSWORD = 6; // Supabase 기본 최소 길이

export default function LoginForm({
  next,
  confirmFailed,
}: {
  next?: string;
  confirmFailed?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    // 가입한 브라우저가 아닌 곳(휴대폰 등)에서 링크를 열어도 여기로 온다. 메일 확인은 이미 끝났을 수 있다
    confirmFailed
      ? "확인 링크를 로그인으로 바꾸지 못했습니다. 메일 확인은 됐을 수 있으니 로그인해 보세요."
      : null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const name = displayName.trim();
  const valid =
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD &&
    (mode === "signIn" || (name.length > 0 && name.length <= 20));

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNotice(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = getSupabase();
    const target = safeNext(next);

    if (mode === "signIn") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setError(signInMessage(error.message));
        setBusy(false);
        return;
      }
      // 쿠키가 담긴 채로 새로 불러와야 proxy.ts 가 로그인으로 본다
      window.location.assign(target);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // profiles 행을 만들 때(WU-02 트리거) 이 이름을 쓴다
        data: { display_name: name },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`,
      },
    });
    setBusy(false);
    if (error) {
      setError(signUpMessage(error.message));
      return;
    }
    // 메일 확인이 켜져 있으면 이미 가입된 이메일도 오류 없이 돌아온다 (가입 여부를 숨기려고). 메일은 가지 않는다
    if (data.user && data.user.identities?.length === 0) {
      setError("이미 가입된 이메일입니다. 로그인하세요.");
      setMode("signIn");
      return;
    }
    if (data.session) {
      window.location.assign(target);
      return;
    }
    setNotice(`${email.trim()} 로 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인하세요.`);
    setMode("signIn");
    setPassword("");
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
        <div className={s.titleRow}>
          <h1>
            <WorkOnLogo height={30} />
          </h1>
          <ThemeToggle />
        </div>
        <p className={s.slogan}>연결되면, 일이 시작됩니다.</p>
        <div className={s.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signIn"}
            className={mode === "signIn" ? s.tabActive : s.tab}
            onClick={() => switchMode("signIn")}
          >
            로그인
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signUp"}
            className={mode === "signUp" ? s.tabActive : s.tab}
            onClick={() => switchMode("signUp")}
          >
            가입
          </button>
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
          autoComplete={mode === "signIn" ? "current-password" : "new-password"}
          placeholder={`비밀번호 (${MIN_PASSWORD}자 이상)`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === "signUp" && (
          <input
            placeholder="표시 이름 (1~20자)"
            maxLength={20}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        )}

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={s.notice} role="status">
            {notice}
          </p>
        )}

        <button type="submit" disabled={!valid || busy}>
          {busy ? "잠시만요…" : mode === "signIn" ? "로그인" : "가입하기"}
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

function signUpMessage(raw: string): string {
  if (/already registered/i.test(raw)) return "이미 가입된 이메일입니다. 로그인하세요.";
  if (/rate limit/i.test(raw)) return "메일을 너무 자주 보냈습니다. 잠시 뒤 다시 시도하세요.";
  if (/password/i.test(raw)) return `비밀번호를 확인하세요: ${raw}`;
  return `가입하지 못했습니다: ${raw}`;
}
