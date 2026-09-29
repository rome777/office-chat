// ① 첨부 2단계 — 올린 파일 확정. POST { channel_id, path, file_name, client_id, body } → { message, attachment }
// 파일 앞부분의 시그니처(PNG·JPEG·PDF)를 확인한다. 맞지 않으면 Storage 에서 지우고 거부한다.
// 맞으면 메시지와 첨부 행을 한 번에 만든다 (post_attachment_message). 같은 client_id 로 다시 불러도 한 번만 생긴다.

import { NextResponse, type NextRequest } from "next/server";
import { ATTACHMENT_MAX_BYTES, SIGNATURE_BYTES, detectAttachmentType } from "@/lib/attachments";
import { BUCKET, adminSupabase, currentUser, fail, isMember, isUuid, uploadPrefix } from "../_lib/server";

export async function POST(request: NextRequest) {
  const { supabase, user } = await currentUser();
  if (!user) return fail(401, "로그인이 필요합니다");

  const input = await request.json().catch(() => null);
  const { channel_id, path, file_name, client_id, body = "" } = input ?? {};
  if (!isUuid(channel_id) || !isUuid(client_id)) return fail(400, "channel_id·client_id 가 올바르지 않습니다");
  if (typeof file_name !== "string" || file_name.trim().length === 0 || file_name.length > 200) {
    return fail(400, "파일 이름은 1~200자여야 합니다");
  }
  if (typeof body !== "string" || body.length > 2000) return fail(400, "메시지는 2000자까지입니다");
  // 자기가 이 채널에 올린 파일만 확정할 수 있다
  if (typeof path !== "string" || !path.startsWith(uploadPrefix(channel_id, user.id)) || path.includes("..")) {
    return fail(400, "파일 경로가 올바르지 않습니다");
  }
  if (!(await isMember(supabase, channel_id))) return fail(403, "이 대화의 멤버가 아닙니다");

  const admin = adminSupabase();
  const storage = admin.storage.from(BUCKET);
  const reject = async (status: number, message: string) => {
    await storage.remove([path]);
    return fail(status, message);
  };

  // 다시 보내기: 첫 확정이 성공했는데 응답만 못 받았으면, 화면은 파일을 새 경로로 다시 올린다.
  // 같은 client_id 메시지에 이미 첨부가 있으면 새로 올린 파일은 지우고 먼저 저장한 것을 돌려준다
  let savedPath = path;
  const prior = await admin
    .from("messages")
    .select("id, attachments(storage_path)")
    .eq("client_id", client_id)
    .eq("user_id", user.id)
    .maybeSingle();
  const priorPath = (prior.data?.attachments as { storage_path: string }[] | undefined)?.[0]?.storage_path;
  if (priorPath) {
    if (priorPath !== path) await storage.remove([path]);
    savedPath = priorPath;
  } else {
    const info = await storage.info(path);
    if (info.error || !info.data) return fail(404, "올린 파일을 찾을 수 없습니다. 다시 올려 주세요");
    const size = Number(info.data.size);
    if (!Number.isFinite(size) || size <= 0) return reject(400, "빈 파일입니다");
    if (size > ATTACHMENT_MAX_BYTES) return reject(413, "5MB 이하만 올릴 수 있습니다");

    const head = await readHead(path);
    if (!head) return fail(502, "올린 파일을 읽지 못했습니다. 다시 시도해 주세요");
    const mime = detectAttachmentType(head);
    if (!mime) return reject(415, "파일 내용이 PNG·JPEG·PDF 가 아닙니다 (확장자만 바꾼 파일은 올릴 수 없습니다)");

    const saved = await admin.rpc("post_attachment_message", {
      p_user_id: user.id,
      p_channel_id: channel_id,
      p_client_id: client_id,
      p_body: body,
      p_storage_path: path,
      p_mime: mime,
      p_size: size,
      p_file_name: file_name.trim(),
    });
    if (saved.error) return fail(saved.error.code === "42501" ? 403 : 500, saved.error.message);
  }

  const attachment = await admin
    .from("attachments")
    .select("id, message_id, mime, size, file_name")
    .eq("storage_path", savedPath)
    .single();
  if (attachment.error) return fail(500, attachment.error.message);
  const message = await admin.from("messages").select("*").eq("id", attachment.data.message_id).single();
  if (message.error) return fail(500, message.error.message);

  return NextResponse.json(
    { message: message.data, attachment: attachment.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** 파일 앞 몇 바이트만 받는다 (5MB 를 다 받지 않는다) */
async function readHead(path: string): Promise<Uint8Array | null> {
  const signed = await adminSupabase().storage.from(BUCKET).createSignedUrl(path, 30);
  if (signed.error || !signed.data) return null;
  const res = await fetch(signed.data.signedUrl, { headers: { Range: `bytes=0-${SIGNATURE_BYTES - 1}` } });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer()).slice(0, SIGNATURE_BYTES);
}
