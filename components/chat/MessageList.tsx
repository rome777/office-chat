"use client";

// ① 메시지 목록과 스크롤. 새 메시지가 오면 맨 아래로, 위를 보고 있으면 "새 메시지" 버튼만 띄운다.
// 맨 위에 가까이 올리면 이전 메시지를 불러오고, 위에 붙은 만큼 내려서 보던 자리를 지킨다.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage, MessageAttachment, PendingMessage } from "@/lib/types/message";
import type { Self } from "./useSelf";
import type { ReactionMap } from "./useReactions";
import { MessageItem, PendingItem } from "./MessageItem";
import s from "./chat.module.css";

/** 맨 위에서 이만큼 안쪽으로 들어오면 이전 메시지를 불러온다 (px) */
const LOAD_OLDER_AT = 120;
const HIGHLIGHT_MS = 2500;
/** 스크롤이 멈추고 이만큼 지나면 읽음을 남긴다 (스크롤 중에 계속 보내지 않게) */
const READ_DEBOUNCE_MS = 400;

/** 목록 맨 위에서 그 메시지까지의 거리 (스크롤과 무관) */
function topOf(list: HTMLElement, messageId: number): number {
  const item = list.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  if (!item) return 0;
  return item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
}

const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(iso));

/** 이동해서 강조할 메시지. 같은 메시지로 다시 이동해도 동작하도록 seq 를 올린다 */
export type Focus = { id: number; seq: number };

export default function MessageList({
  messages,
  pending,
  self,
  names,
  attachments,
  sendTick,
  hasOlder,
  loadingOlder,
  focus,
  onLoadOlder,
  onFocusMissing,
  onRead,
  unreadCount,
  handles,
  onOpenThread,
  onRetry,
  onDiscard,
  reactions,
  pinned,
  onReact,
  onPin,
}: {
  messages: ChatMessage[];
  pending: PendingMessage[];
  self: Self | null;
  /** 작성자 id → 표시 이름 */
  names: Record<string, string>;
  /** 메시지 id → 첨부 */
  attachments: Record<number, MessageAttachment[]>;
  /** 내가 보낼 때마다 바뀐다. 바뀌면 위를 보고 있었어도 맨 아래로 내린다 */
  sendTick: number;
  hasOlder: boolean;
  loadingOlder: boolean;
  focus: Focus | null;
  onLoadOlder: () => void;
  /** 이동하려던 메시지가 목록에 없을 때 (지워졌거나 볼 수 없는 메시지) */
  onFocusMissing: () => void;
  /** 화면에 실제로 보인 마지막 메시지 id. 탭이 보일 때만 부른다 (PRD "읽음"의 뜻) */
  onRead: (messageId: number) => void;
  /** 메시지 옆에 띄울 안 읽은 사람 수 */
  unreadCount: (messageId: number, authorId: string | null) => number;
  /** 채널 멤버 handle (소문자) */
  handles: ReadonlySet<string>;
  onOpenThread: (messageId: number) => void;
  onRetry: (p: PendingMessage) => void;
  onDiscard: (clientId: string) => void;
  /** 리액션·고정 (2026-09-30) */
  reactions: ReactionMap;
  pinned: ReadonlySet<number>;
  onReact: (messageId: number, emoji: string) => void;
  onPin: (messageId: number) => void;
}) {
  const [hasUnseen, setHasUnseen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastTickRef = useRef(sendTick);
  // 지난 그림의 첫 메시지와 그 위치, 마지막 메시지. 위에 붙었는지, 아래에 붙었는지를 가린다
  const prevRef = useRef({ firstId: 0, firstTop: 0, lastKey: "" });

  // 읽음: 목록 안에 실제로 보이는 메시지 가운데 가장 아래 것까지 읽은 것으로 본다.
  // 탭이 가려져 있으면 보이지 않은 것이므로 남기지 않는다. 다시 보이면 그때 남긴다
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  function scheduleRead() {
    clearTimeout(readTimerRef.current);
    readTimerRef.current = setTimeout(() => {
      const el = listRef.current;
      if (!el || document.visibilityState !== "visible") return;
      const box = el.getBoundingClientRect();
      const items = el.querySelectorAll<HTMLElement>("[data-message-id]");
      for (let i = items.length - 1; i >= 0; i--) {
        const r = items[i].getBoundingClientRect();
        if (r.top < box.bottom && r.bottom > box.top) {
          onReadRef.current(Number(items[i].dataset.messageId));
          return;
        }
      }
    }, READ_DEBOUNCE_MS);
  }

  useEffect(() => {
    const again = () => scheduleRead();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      clearTimeout(readTimerRef.current);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, []);

  function onScroll() {
    scheduleRead();
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stickToBottomRef.current) setHasUnseen(false);
    if (el.scrollTop < LOAD_OLDER_AT && hasOlder && !loadingOlder) onLoadOlder();
  }

  function scrollToBottom() {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setHasUnseen(false);
  }

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const prev = prevRef.current;
    const firstId = messages[0]?.id ?? 0;
    const lastKey = `${messages.at(-1)?.id ?? 0}:${pending.length}:${pending.at(-1)?.clientId ?? ""}`;
    const sentByMe = lastTickRef.current !== sendTick;
    lastTickRef.current = sendTick;

    const prepended = prev.firstId !== 0 && firstId < prev.firstId;
    const appended = lastKey !== prev.lastKey;

    // 원래 첫 메시지가 밀려 내려간 만큼 같이 내려서 보던 자리를 지킨다 (CSS 의 overflow-anchor 는 꺼 뒀다).
    // 전체 높이 차로 재면 그사이 창 폭이 바뀌어 줄바꿈이 달라졌을 때 틀어진다 (2026-09-29 확인)
    if (prepended) el.scrollTop += topOf(el, prev.firstId) - prev.firstTop;
    if (sentByMe || (appended && stickToBottomRef.current)) {
      scrollToBottom();
    } else if (appended && prev.lastKey !== "") {
      setHasUnseen(true);
    }
    prevRef.current = { firstId, firstTop: topOf(el, firstId), lastKey };
    scheduleRead();
  }, [messages, pending, sendTick]);

  // 메시지로 이동: 가운데로 스크롤하고 잠깐 강조한다
  useLayoutEffect(() => {
    if (!focus) return;
    const target = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${focus.id}"]`);
    if (!target) {
      onFocusMissing();
      return;
    }
    stickToBottomRef.current = false;
    target.scrollIntoView({ block: "center" });
    setHighlightId(focus.id);
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
    // onFocusMissing 은 매번 새로 만들어지는 함수라 넣지 않는다. 이동은 focus 가 바뀔 때만 한다
  }, [focus]);

  return (
    <div className={s.listWrap}>
      <div className={s.list} ref={listRef} onScroll={onScroll}>
        {hasOlder ? (
          <button className={`link ${s.older}`} onClick={onLoadOlder} disabled={loadingOlder}>
            {loadingOlder ? "이전 메시지 불러오는 중…" : "이전 메시지 더 보기"}
          </button>
        ) : (
          messages.length > 0 && <p className={`${s.older} muted`}>대화의 처음입니다</p>
        )}
        {messages.length === 0 && pending.length === 0 && (
          <p className={`${s.empty} muted`}>아직 메시지가 없습니다. 첫 메시지를 보내 보세요.</p>
        )}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
          {/* 날짜가 바뀌는 곳에 구분선 (한국 시각 기준) */}
          {(i === 0 || dayKey(messages[i - 1].created_at) !== dayKey(m.created_at)) && (
            <p className={s.dayDivider}>
              <span>{dayKey(m.created_at)}</span>
            </p>
          )}
          <MessageItem
            message={m}
            authorName={m.author ?? (m.user_id ? names[m.user_id] : undefined) ?? "…"}
            mine={!!self && m.user_id === self.id}
            myHandle={self?.handle ?? undefined}
            highlighted={m.id === highlightId}
            files={attachments[m.id]}
            unread={unreadCount(m.id, m.user_id)}
            handles={handles}
            onOpenThread={() => onOpenThread(m.id)}
            extras={{
              reactions: reactions.get(m.id),
              selfId: self?.id ?? null,
              pinned: pinned.has(m.id),
              onReact: (emoji) => onReact(m.id, emoji),
              onPin: () => onPin(m.id),
            }}
          />
          </Fragment>
        ))}
        {pending.map((p) => (
          <PendingItem
            key={p.clientId}
            message={p}
            myHandle={self?.handle ?? undefined}
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
