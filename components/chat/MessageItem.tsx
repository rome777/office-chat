// ① 메시지 한 건

import { formatBytes } from "@/lib/attachments";
import type { ChatMessage, MessageAttachment, PendingMessage } from "@/lib/types/message";
import AttachmentView from "./AttachmentView";
import SafeText from "./SafeText";
import s from "./chat.module.css";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export function MessageItem({
  message,
  authorName,
  mine,
  myHandle,
  highlighted,
  files,
  unread,
}: {
  message: ChatMessage;
  /** 로그인한 사람은 profiles 의 이름, Step 1 익명 메시지는 닉네임 */
  authorName: string;
  mine: boolean;
  /** 나를 부른 멘션(@handle)을 더 눈에 띄게 한다 */
  myHandle?: string;
  /** 메시지로 이동(`?m=`)해서 잠깐 강조 중 */
  highlighted: boolean;
  files?: MessageAttachment[];
  /** 작성자를 뺀 멤버 가운데 아직 안 읽은 사람 수 (0 이면 안 보인다) */
  unread: number;
}) {
  return (
    <article
      data-message-id={message.id}
      className={`${s.msg} ${mine ? s.mine : ""} ${highlighted ? s.highlight : ""}`}
    >
      <div className={s.meta}>
        <strong>{authorName}</strong>
        <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
        {unread > 0 && (
          <span className={s.unread} title={`안 읽은 사람 ${unread}명`} aria-label={`안 읽은 사람 ${unread}명`}>
            {unread}
          </span>
        )}
      </div>
      {message.body && (
        <p className={s.body}>
          <SafeText text={message.body} mentions={{ me: myHandle }} />
        </p>
      )}
      {files && files.length > 0 && <AttachmentView files={files} />}
    </article>
  );
}

export function PendingItem({
  message,
  myHandle,
  onRetry,
  onDiscard,
}: {
  message: PendingMessage;
  myHandle?: string;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <article className={`${s.msg} ${s.mine} ${s[message.status]}`}>
      <div className={s.meta}>
        <strong>{message.author}</strong>
        <span>
          {message.status === "failed" ? "전송 실패" : message.file ? "올리는 중…" : "보내는 중…"}
        </span>
      </div>
      {message.body && (
        <p className={s.body}>
          <SafeText text={message.body} mentions={{ me: myHandle }} />
        </p>
      )}
      {message.file && (
        <p className={`${s.fileLink} muted`}>
          📎 {message.file.name} ({formatBytes(message.file.size)})
        </p>
      )}
      {message.status === "failed" && (
        <div className={s.actions}>
          <span className="error-text">{message.error}</span>
          <button className="link" onClick={onRetry}>
            다시 보내기
          </button>
          <button className="link" onClick={onDiscard}>
            삭제
          </button>
        </div>
      )}
    </article>
  );
}
