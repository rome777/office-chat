// ① 첨부 3단계 — 내려받기·미리보기. GET /api/attachments/{id}  (?download=1 이면 저장 창)
// 사용자 토큰으로 첨부 행을 조회한다 → 그 대화의 멤버가 아니면 RLS 가 0건을 돌려줘서 404.
// 멤버면 60초짜리 서명 URL 로 보낸다. 버킷은 비공개라 파일 주소를 알아도 서명 없이는 못 연다.

import { NextResponse, type NextRequest } from "next/server";
import { BUCKET, adminSupabase, currentUser, fail, isUuid } from "../_lib/server";

const SIGNED_URL_SECONDS = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await currentUser();
  if (!user) return fail(401, "로그인이 필요합니다");
  if (!isUuid(id)) return fail(404, "첨부를 찾을 수 없습니다");

  const { data } = await supabase
    .from("attachments")
    .select("storage_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!data) return fail(404, "첨부를 찾을 수 없습니다");

  const download = request.nextUrl.searchParams.has("download");
  const signed = await adminSupabase()
    .storage.from(BUCKET)
    .createSignedUrl(data.storage_path, SIGNED_URL_SECONDS, { download: download ? data.file_name : false });
  if (signed.error || !signed.data) return fail(502, "파일 주소를 만들지 못했습니다");

  const res = NextResponse.redirect(signed.data.signedUrl, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
