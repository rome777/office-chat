// ① 메시지 한 건

import { formatBytes } from "@/lib/attachments";
import { useMentionLabels, useMyMentionTokens } from "@/components/people/directory";
import type { ChatMessage, MessageAttachment, PendingMessage } from "@/lib/types/message";
import PersonAvatar from "@/components/profile/PersonAvatar"; // ② 사진·상태 점 (2026-09-30)
import { useMyProfile } from "@/components/profile/profileSource";
import { useState } from "react";
import { openProfileCard } from "@/components/shell/cardStore";
import AttachmentView from "./AttachmentView";
import { REACTIONS } from "./useReactions";
import SafeText from "./SafeText";
import s from "./chat.module.css";

const AVATAR = 32; // 메시지 왼쪽 프로필 사진 크기(px)

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
  handles,
  onOpenThread,
  extras,
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
  /** 채널 멤버 handle (소문자). 멤버를 부른 멘션만 강조한다 */
  handles?: ReadonlySet<string>;
  /** 주면 스레드 버튼을 보인다 (채널 본문의 최상위 메시지만. 스레드 패널 안에서는 주지 않는다) */
  onOpenThread?: () => void;
  /** 리액션·고정 (채널 본문에서만 준다, 2026-09-30) */
  extras?: {
    reactions?: ReadonlyMap<string, ReadonlySet<string>>;
    selfId: string | null;
    pinned: boolean;
    onReact: (emoji: string) => void;
    onPin: () => void;
  };
}) {
  const names = useMentionLabels(); // 멘션을 아이디 대신 이름으로 (lib/mentions)
  const callsMe = useMyMentionTokens(myHandle); // @모두·@내 부서도 나를 부른 것으로 강조
  const [picking, setPicking] = useState(false);
  const author = message.user_id;
  const reactions = extras?.reactions ? [...extras.reactions] : [];
  return (
    <article
      data-message-id={message.id}
      className={`${s.msg} ${mine ? s.mine : ""} ${highlighted ? s.highlight : ""} ${extras?.pinned ? s.pinned : ""}`}
      onMouseLeave={() => setPicking(false)}
    >
      {/* 화면 읽기는 작성자 이름부터 읽게 사진·상태는 뺀다 (상태는 조직도에서 읽는다). 누르면 프로필 카드 */}
      <span className={s.avatarCol} aria-hidden="true">
        {author ? (
          <button type="button" tabIndex={-1} className={s.avatarButton} onClick={() => openProfileCard(author)}>
            <PersonAvatar userId={author} name={authorName} size={AVATAR} />
          </button>
        ) : (
          <PersonAvatar userId={null} name={authorName} size={AVATAR} />
        )}
      </span>
      <div className={s.msgMain}>
        <div className={s.meta}>
          {author ? (
            <button type="button" className={s.authorButton} onClick={() => openProfileCard(author)}>
              <strong>{authorName}</strong>
            </button>
          ) : (
            <strong>{authorName}</strong>
          )}
          <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
          {unread > 0 && (
            <span className={s.unread} title={`안 읽은 사람 ${unread}명`} aria-label={`안 읽은 사람 ${unread}명`}>
              {unread}
            </span>
          )}
        </div>
        {message.body && (
          <p className={s.body}>
            <SafeText text={message.body} mentions={{ me: myHandle, handles, names, mine: callsMe }} />
          </p>
        )}
        {files && files.length > 0 && <AttachmentView files={files} />}
        {reactions.length > 0 && (
          <div className={s.reactions}>
            {reactions.map(([emoji, users]) => {
              const on = !!extras?.selfId && users.has(extras.selfId);
              return (
                <button
                  key={emoji}
                  type="button"
                  className={`${s.reaction} ${on ? s.reactionOn : ""}`}
                  aria-pressed={on}
                  aria-label={`${emoji} ${users.size}명${on ? ", 내가 누름" : ""}`}
                  onClick={() => extras?.onReact(emoji)}
                >
                  {emoji} <span>{users.size}</span>
                </button>
              );
            })}
          </div>
        )}
        {onOpenThread && message.reply_count > 0 && (
          <button type="button" className={`link ${s.replies}`} onClick={onOpenThread}>
            💬 답글 {message.reply_count}개
          </button>
        )}
      </div>
      {(extras || onOpenThread) && (
        <div className={`${s.tools} ${picking ? s.toolsOpen : ""}`} role="toolbar" aria-label="메시지 도구">
          {extras && (
            <button type="button" className={s.tool} onClick={() => setPicking((v) => !v)} aria-expanded={picking} aria-label="리액션 달기" title="리액션 달기">
              😀
            </button>
          )}
          {onOpenThread && (
            <button type="button" className={s.tool} onClick={onOpenThread} aria-label="답글 달기" title="답글 달기">
              💬
            </button>
          )}
          {extras && (
            <button
              type="button"
              className={`${s.tool} ${extras.pinned ? s.toolOn : ""}`}
              onClick={extras.onPin}
              aria-pressed={extras.pinned}
              aria-label={extras.pinned ? "고정 해제" : "채널에 고정"}
              title={extras.pinned ? "고정 해제" : "채널에 고정"}
            >
              📌
            </button>
          )}
          {picking && extras && (
            <div className={s.picker} role="group" aria-label="리액션 고르기">
              {REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    extras.onReact(e);
                    setPicking(false);
                  }}
                  aria-label={e}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
  const names = useMentionLabels();
  const { profile } = useMyProfile(); // 보내는 중인 메시지는 늘 내 것
  return (
    <article className={`${s.msg} ${s.mine} ${s[message.status]}`}>
      <span className={s.avatarCol} aria-hidden="true">
        <PersonAvatar userId={profile?.id ?? null} name={message.author} size={AVATAR} />
      </span>
      <div className={s.msgMain}>
        <div className={s.meta}>
          <strong>{message.author}</strong>
          <span>
            {message.status === "failed" ? "전송 실패" : message.file ? "올리는 중…" : "보내는 중…"}
          </span>
        </div>
        {message.body && (
          <p className={s.body}>
            <SafeText text={message.body} mentions={{ me: myHandle, names }} />
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
      </div>
    </article>
  );
}
