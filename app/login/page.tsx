// ② 로그인 화면. 로그인한 사람이 들어오면 proxy.ts 가 채팅 화면으로 돌려보낸다.

import LoginForm from "@/components/auth/LoginForm";
import { safeNext } from "@/components/auth/safeNext";

export const metadata = { title: "로그인 · 오피스톡" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const { next, error } = await searchParams;
  return <LoginForm next={safeNext(next)} confirmFailed={error === "confirm"} />;
}
