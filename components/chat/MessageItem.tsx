// ① 메시지 한 건

import type { ChatMessage, PendingMessage } from "@/lib/types/message";
import SafeText from "./SafeText";
import s from "./chat.module.css";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export function MessageItem({ message, mine }: { message: ChatMessage; mine: boolean }) {
  return (
    <article className={`${s.msg} ${mine ? s.mine : ""}`}>
      <div className={s.meta}>
        <strong>{message.author}</strong>
        <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
      </div>
      <p className={s.body}>
        <SafeText text={message.body} />
      </p>
    </article>
  );
}

export function PendingItem({
  message,
  onRetry,
  onDiscard,
}: {
  message: PendingMessage;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <article className={`${s.msg} ${s.mine} ${s[message.status]}`}>
      <div className={s.meta}>
        <strong>{message.author}</strong>
        <span>{message.status === "sending" ? "보내는 중…" : "전송 실패"}</span>
      </div>
      <p className={s.body}>
        <SafeText text={message.body} />
      </p>
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
