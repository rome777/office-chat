// ① 메시지에 붙은 첨부. 이미지는 미리보기, PDF 는 내려받기 링크.
// 파일은 /api/attachments/{id} 로만 연다 (멤버 확인 뒤 60초짜리 서명 URL 로 보낸다).

import { formatBytes } from "@/lib/attachments";
import type { MessageAttachment } from "@/lib/types/message";
import s from "./chat.module.css";

export default function AttachmentView({ files }: { files: MessageAttachment[] }) {
  return (
    <div className={s.attachments}>
      {files.map((f) => {
        const href = `/api/attachments/${f.id}`;
        if (f.mime.startsWith("image/")) {
          return (
            <a key={f.id} href={href} target="_blank" rel="noopener noreferrer" title={f.file_name}>
              {/* 높이를 고정해 둬서 이미지가 늦게 떠도 목록이 밀리지 않는다 */}
              <img className={s.thumb} src={href} alt={f.file_name} loading="lazy" />
            </a>
          );
        }
        return (
          <a key={f.id} className={s.fileLink} href={`${href}?download=1`}>
            📄 {f.file_name} <span className="muted">({formatBytes(f.size)})</span>
          </a>
        );
      })}
    </div>
  );
}
