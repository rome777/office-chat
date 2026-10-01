"use client";

// ① 스레드 패널. 오른쪽 패널(③)이 `{ kind: "thread" }` 일 때 이것을 그린다.
// 부모 메시지 아래에 답글을 보여 주고, 아래 입력창으로 답글을 단다 (답글에는 첨부 없음).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import type { ChatMessage } from "@/lib/types/message";
import Composer from "./Composer";
import { MessageItem, PendingItem } from "./MessageItem";
import { onReplyFocus, takeReplyFocus } from "./threadFocus";
import { useChannelMembers } from "./useChannelMembers";
import { useSelf } from "./useSelf";
import { useThread } from "./useThread";
import s from "./chat.module.css";

const HIGHLIGHT_MS = 2500;

export default function ThreadPanel({ messageId }: { messageId: number }) {
  const { me } = useWorkspace();
  const self = useSelf();
  const { parent, replies, pending, missing, send, discard } = useThread(messageId, me.name);
  const members = useChannelMembers(parent?.channel_id ?? "");
  const names = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.display_name])), [members]);
  const handles = useMemo(() => new Set(members.map((m) => m.handle.toLowerCase())), [members]);
  const listRef = useRef<HTMLDivElement>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  const nameOf = (m: ChatMessage) => (m.user_id ? names[m.user_id] : undefined) ?? "…";

  // 새 답글이 오면 맨 아래로 (답글로 이동할 때는 아래 효과가 그 답글로 다시 스크롤한다)
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies.length, pending.length]);

  // `?m=<답글 id>` 로 왔으면 그 답글로 스크롤하고 강조한다
  useEffect(() => {
    const tryFocus = () => {
      const id = takeReplyFocus(replies.map((r) => r.id));
      if (id === null) return;
      setHighlightId(id);
      requestAnimationFrame(() =>
        listRef.current?.querySelector(`[data-message-id="${id}"]`)?.scrollIntoView({ block: "center" }),
      );
    };
    tryFocus();
    return onReplyFocus(tryFocus);
  }, [replies]);

  useEffect(() => {
    if (highlightId === null) return;
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  if (missing) return <p className="muted">메시지를 찾을 수 없습니다. 지워졌거나 볼 수 없는 메시지입니다.</p>;
  if (!parent) return <p className="muted">불러오는 중…</p>;

  return (
    <div className={s.thread}>
      <div className={s.threadList} ref={listRef}>
        <MessageItem
          message={parent}
          authorName={nameOf(parent)}
          mine={!!self && parent.user_id === self.id}
          myHandle={self?.handle ?? undefined}
          highlighted={false}
          files={parent.attachments}
          unread={0}
          handles={handles}
        />
        <p className={`${s.threadDivider} muted`}>
          {replies.length > 0 ? `답글 ${replies.length}개` : "아직 답글이 없습니다"}
        </p>
        {replies.map((r) => (
          <MessageItem
            key={r.id}
            message={r}
            authorName={nameOf(r)}
            mine={!!self && r.user_id === self.id}
            myHandle={self?.handle ?? undefined}
            highlighted={r.id === highlightId}
            unread={0}
            handles={handles}
          />
        ))}
        {pending.map((p) => (
          <PendingItem
            key={p.clientId}
            message={p}
            myHandle={self?.handle ?? undefined}
            onRetry={() => void send(p.body, p.clientId)}
            onDiscard={() => discard(p.clientId)}
          />
        ))}
      </div>
      <Composer
        placeholder="스레드에 답글 달기 (Enter 전송, @ 로 멘션)"
        members={members}
        selfId={self?.id ?? null}
        allowFiles={false}
        onSend={(body) => void send(body)}
      />
    </div>
  );
}
