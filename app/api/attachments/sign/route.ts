// ① 첨부 1단계 — 업로드 주소 받기. POST { channel_id, file_name, size, mime } → { path, token }
// 멤버십·형식·크기를 검사하고 Storage 업로드용 서명 토큰을 준다. 파일은 브라우저가 Storage 로 바로 올린다
// (Vercel 서버 함수는 요청 본문이 약 4.5MB 로 제한돼서 5MB 파일을 직접 받을 수 없다).

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ATTACHMENT_MAX_BYTES, isAttachmentMime } from "@/lib/attachments";
import {
  BUCKET,
  adminSupabase,
  currentUser,
  fail,
  isMember,
  isUuid,
  storageFileName,
  uploadPrefix,
} from "../_lib/server";

export async function POST(request: NextRequest) {
  const { supabase, user } = await currentUser();
  if (!user) return fail(401, "로그인이 필요합니다");

  const input = await request.json().catch(() => null);
  const { channel_id, file_name, size, mime } = input ?? {};
  if (!isUuid(channel_id)) return fail(400, "channel_id 가 올바르지 않습니다");
  if (typeof file_name !== "string" || file_name.trim().length === 0 || file_name.length > 200) {
    return fail(400, "파일 이름은 1~200자여야 합니다");
  }
  if (typeof mime !== "string" || !isAttachmentMime(mime)) return fail(415, "PNG·JPEG·PDF 파일만 올릴 수 있습니다");
  if (!Number.isInteger(size) || size <= 0) return fail(400, "파일 크기가 올바르지 않습니다");
  if (size > ATTACHMENT_MAX_BYTES) return fail(413, "5MB 이하만 올릴 수 있습니다");
  if (!(await isMember(supabase, channel_id))) return fail(403, "이 대화의 멤버가 아닙니다");

  const path = `${uploadPrefix(channel_id, user.id)}${randomUUID()}-${storageFileName(file_name)}`;
  const { data, error } = await adminSupabase().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return fail(502, `업로드 주소를 만들지 못했습니다: ${error?.message ?? "알 수 없음"}`);

  return NextResponse.json({ path: data.path, token: data.token }, { headers: { "Cache-Control": "no-store" } });
}
