"use client";

// ② 이메일 로그인 화면. 가입 탭은 2026-09-30 뺐다 — 가입 처리는 ./signUp.ts 에 따로 남겨 두었다 (지금은 쓰지 않음).
// 배치(2026-09-30 사용자가 시안 C 를 고름): 테마 스위치는 카드 오른쪽 위, 로고(38px)·카피는 가운데

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import WorkOnLogo from "@/components/brand/WorkOnLogo";
import ThemeToggle from "@/components/sidebar/ThemeToggle";
import { onlineElsewhere } from "@/components/profile/presence";
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
  const [inUse, setInUse] = useState(false); // 로그인은 됐고, 같은 계정이 다른 곳에서 접속 중이라 경고를 띄운 상태
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
    const { data, error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(signInMessage(error.message));
      setBusy(false);
      return;
    }
    // 같은 계정이 다른 곳에서 접속 중이면 경고만 한다 (막지는 않는다 — 2026-10-01 사용자 결정, 시연 체험 계정을 나눠 쓸 때)
    if (data.user && (await onlineElsewhere(data.user.id))) {
      setInUse(true);
      setBusy(false);
      return;
    }
    enter();
  }

  // 쿠키가 담긴 채로 새로 불러와야 proxy.ts 가 로그인으로 본다
  function enter() {
    window.location.assign(safeNext(next));
  }

  // 경고에서 "다른 계정으로": 방금 만든 이 브라우저의 세션만 지운다 (먼저 접속한 쪽은 그대로)
  async function switchAccount() {
    setBusy(true);
    await getSupabase().auth.signOut({ scope: "local" });
    setInUse(false);
    setPassword("");
    setBusy(false);
  }

  if (inUse) {
    return (
      <main className={s.entry}>
        <div className={s.card} role="alertdialog" aria-labelledby="in-use-title">
          <div className={s.themeCorner}>
            <ThemeToggle />
          </div>
          <h1 id="in-use-title" className={s.warnTitle}>
            이미 접속 중인 계정입니다
          </h1>
          <p className={s.warnText}>
            <b>{email.trim()}</b> 계정이 지금 다른 브라우저나 기기에서 접속해 있습니다. 다른 분이 쓰는 계정일 수 있어요.
            계속하면 같은 계정으로 두 곳에서 접속하게 됩니다.
          </p>
          <button type="button" className={s.secondary} disabled={busy} onClick={() => void switchAccount()}>
            다른 계정으로 로그인
          </button>
          <button type="button" className={s.primaryBtn} disabled={busy} onClick={enter}>
            그래도 계속
          </button>
        </div>
      </main>
    );
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
          <p className={s.slogan}>연결되면, 업무가 시작됩니다.</p>
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
