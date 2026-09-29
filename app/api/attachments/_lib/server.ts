// ① 첨부 API 공통 (서버 전용). 라우트가 아니다 (`_` 로 시작하는 폴더는 Next.js 가 주소로 만들지 않는다).
//
// 권한 확인은 사용자 토큰(쿠키)으로 한다 → RLS 가 판단한다.
// Storage 서명 URL 과 첨부 행 쓰기만 service role 로 한다 (attachments 는 클라이언트 쓰기 권한이 없다).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const BUCKET = "attachments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

let admin: SupabaseClient | null = null;

export function adminSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY 가 없습니다 (.env.local·Vercel 환경 변수)");
  admin ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** 로그인한 사람과, 그 사람 토큰으로 조회하는 클라이언트. 로그인하지 않았으면 user 가 null */
export async function currentUser() {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function isMember(supabase: SupabaseClient, channelId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_member", { p_channel: channelId });
  return !error && data === true;
}

export function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Storage 경로에 쓸 파일 이름. Storage 는 한글 등 ASCII 밖 글자가 든 경로를 거부한다 → 원래 이름은 DB 에만 둔다 */
export function storageFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) || "file";
  return ext ? `${base}.${ext}` : base;
}

/** 경로 규칙: {channel_id}/{user_id}/{uuid}-{파일이름}. 올린 사람만 자기 파일을 확정할 수 있게 user_id 를 넣는다 */
export function uploadPrefix(channelId: string, userId: string): string {
  return `${channelId}/${userId}/`;
}
