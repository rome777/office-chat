// ① 첨부 규칙. 화면(입력창)과 서버 API(app/api/attachments)가 같이 쓴다 (TECH_SPEC 7절 "첨부").
// 버킷(attachments)에도 같은 크기·형식 제한이 걸려 있다 (supabase/migrations/20260929100000_db_v1.sql).

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "application/pdf"] as const;
export type AttachmentMime = (typeof ATTACHMENT_TYPES)[number];

/** 파일 고르기 창의 accept 값 */
export const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf";

export function isAttachmentMime(mime: string): mime is AttachmentMime {
  return (ATTACHMENT_TYPES as readonly string[]).includes(mime);
}

/** 파일 앞부분(시그니처)으로 실제 형식을 가린다. 확장자·브라우저가 알려 준 형식은 믿지 않는다 */
export function detectAttachmentType(head: Uint8Array): AttachmentMime | null {
  const starts = (sig: number[]) => sig.every((b, i) => head[i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // "%PDF-"
  return null;
}

/** 시그니처 검사에 필요한 앞부분 바이트 수 */
export const SIGNATURE_BYTES = 8;

export function formatBytes(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

/** 올리기 전에 화면에서 거른다. 통과하면 null (서버가 다시 검사한다) */
export function attachmentProblem(file: { size: number; type: string }): string | null {
  if (!isAttachmentMime(file.type)) return "PNG·JPEG·PDF 파일만 올릴 수 있습니다";
  if (file.size === 0) return "빈 파일입니다";
  if (file.size > ATTACHMENT_MAX_BYTES) return `5MB 이하만 올릴 수 있습니다 (이 파일은 ${formatBytes(file.size)})`;
  return null;
}
