// ② 이메일 가입 — 2026-09-30 로그인 화면에서 "가입" 탭을 뺐다 (사용자 결정. 시연 계정은 seed:company 로 만든다).
// 나중에 다시 열 수 있게 가입 처리만 여기 따로 남겨 둔다. 지금은 아무 화면도 이 파일을 부르지 않는다.
// 다시 쓰려면: LoginForm 에 로그인·가입 전환과 "표시 이름(1~20자)" 칸을 두고 signUpWithEmail 을 부른다.
// 가입 확인 메일의 링크는 app/auth/callback 이 받는다 (그대로 남아 있다). 예전 화면은 git 기록의 LoginForm 에 있다.

import { getSupabase } from "@/lib/supabase";

export const MAX_DISPLAY_NAME = 20; // 메시지 작성자 칸이 20자까지다 (AuthGate)

export type SignUpResult =
  | { kind: "signedIn" } // 메일 확인이 꺼져 있으면 바로 로그인된다 → target 으로 이동
  | { kind: "mailSent" } // 확인 메일을 보냈다 → 링크를 누른 뒤 로그인
  | { kind: "error"; message: string };

export async function signUpWithEmail({
  email,
  password,
  displayName,
  target,
}: {
  email: string;
  password: string;
  displayName: string;
  /** 가입 뒤 갈 주소 (safeNext 로 거른 값) */
  target: string;
}): Promise<SignUpResult> {
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim(),
    password,
    options: {
      // profiles 행을 만들 때(WU-02 트리거) 이 이름을 쓴다
      data: { display_name: displayName.trim() },
      emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`,
    },
  });
  if (error) return { kind: "error", message: signUpMessage(error.message) };
  // 메일 확인이 켜져 있으면 이미 가입된 이메일도 오류 없이 돌아온다 (가입 여부를 숨기려고). 메일은 가지 않는다
  if (data.user && data.user.identities?.length === 0) {
    return { kind: "error", message: "이미 가입된 이메일입니다. 로그인하세요." };
  }
  return data.session ? { kind: "signedIn" } : { kind: "mailSent" };
}

export function signUpMessage(raw: string): string {
  if (/already registered/i.test(raw)) return "이미 가입된 이메일입니다. 로그인하세요.";
  if (/rate limit/i.test(raw)) return "메일을 너무 자주 보냈습니다. 잠시 뒤 다시 시도하세요.";
  if (/password/i.test(raw)) return `비밀번호를 확인하세요: ${raw}`;
  return `가입하지 못했습니다: ${raw}`;
}
