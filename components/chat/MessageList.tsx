"use client";

// ① 메시지 목록과 스크롤. 새 메시지가 오면 맨 아래로, 위를 보고 있으면 "새 메시지" 버튼만 띄운다.

import { useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage, PendingMessage } from "@/lib/types/message";
import { MessageItem, PendingItem } from "./MessageItem";
import s from "./chat.module.css";

export default function MessageList({
  messages,
  pending,
  me,
  sendTick,
  onRetry,
  onDiscard,
}: {
  messages: ChatMessage[];
  pending: PendingMessage[];
  me: string;
  /** 내가 보낼 때마다 바뀐다. 바뀌면 위를 보고 있었어도 맨 아래로 내린다 */
  sendTick: number;
  onRetry: (p: PendingMessage) => void;
  onDiscard: (clientId: string) => void;
}) {
  const [hasUnseen, setHasUnseen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastTickRef = useRef(sendTick);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stickToBottomRef.current) setHasUnseen(false);
  }

  function scrollToBottom() {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setHasUnseen(false);
  }

  useLayoutEffect(() => {
    const sentByMe = lastTickRef.current !== sendTick;
    lastTickRef.current = sendTick;
    if (stickToBottomRef.current || sentByMe) {
      scrollToBottom();
    } else {
      setHasUnseen(true);
    }
  }, [messages, pending, sendTick]);

  return (
    <div className={s.listWrap}>
      <div className={s.list} ref={listRef} onScroll={onScroll}>
        {messages.length === 0 && pending.length === 0 && (
          <p className={`${s.empty} muted`}>아직 메시지가 없습니다. 첫 메시지를 보내 보세요.</p>
        )}
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} mine={m.author === me} />
        ))}
        {pending.map((p) => (
          <PendingItem
            key={p.clientId}
            message={p}
            onRetry={() => onRetry(p)}
            onDiscard={() => onDiscard(p.clientId)}
          />
        ))}
      </div>
      {hasUnseen && (
        <button className={s.unseen} onClick={scrollToBottom}>
          새 메시지 ↓
        </button>
      )}
    </div>
  );
}
