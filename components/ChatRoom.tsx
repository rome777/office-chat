"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChatMessage, ConnectionState, PendingMessage } from "@/lib/types";

const SEND_TIMEOUT_MS = 5000;

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "연결 중",
  connected: "연결됨",
  reconnecting: "재연결 중",
  disconnected: "끊김",
};

// crypto.randomUUID 는 localhost·https 에서만 된다. 같은 네트워크의 IP(http)로 접속해도 되도록 직접 만든다.
function newClientId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

type SendAck = { ok: true; message: ChatMessage } | { ok: false; error: string };
type SyncAck = { bootId: string; reset: boolean; messages: ChatMessage[] };

export default function ChatRoom({ nickname, onLeave }: { nickname: string; onLeave: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [conn, setConn] = useState<ConnectionState>("connecting");
  const [connError, setConnError] = useState<string | null>(null);
  const [online, setOnline] = useState(0);
  const [draft, setDraft] = useState("");
  const [hasUnseen, setHasUnseen] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const lastIdRef = useRef(0);
  const bootIdRef = useRef<string | null>(null);
  const [serverRestarted, setServerRestarted] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const forceScrollRef = useRef(false);

  // 서버 id 를 키로 합친다. 같은 메시지가 두 번 와도 한 번만 그린다.
  const merge = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      const next = [...byId.values()].sort((a, b) => a.id - b.id);
      lastIdRef.current = next[next.length - 1].id;
      return next;
    });
    const saved = new Set(incoming.map((m) => m.clientId));
    setPending((prev) => prev.filter((p) => !saved.has(p.clientId)));
  }, []);

  useEffect(() => {
    const socket = io({ auth: { nickname } });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConn("connected");
      setConnError(null);
      socket.emit(
        "sync",
        { afterId: lastIdRef.current, bootId: bootIdRef.current },
        (res: SyncAck) => {
          if (res.reset) {
            // 처음 접속했거나 서버가 재시작됨: 이전 id 와 겹치지 않게 목록을 새로 채운다
            if (bootIdRef.current !== null) setServerRestarted(true);
            lastIdRef.current = 0;
            setMessages([]);
          }
          bootIdRef.current = res.bootId;
          merge(res.messages);
        },
      );
    });
    socket.on("disconnect", (reason) => {
      setConn("disconnected");
      // 서버가 끊은 경우는 자동 재연결이 안 되므로 직접 다시 붙는다
      if (reason === "io server disconnect") socket.connect();
    });
    socket.io.on("reconnect_attempt", () => setConn("reconnecting"));
    socket.on("connect_error", (err) => {
      if (socket.active) {
        // 네트워크·서버 다운: 자동으로 다시 시도한다
        setConn("reconnecting");
        setConnError("서버에 연결할 수 없습니다. 다시 연결하는 중입니다.");
      } else {
        // 서버가 접속을 거부함 (닉네임 오류 등): 자동 재시도하지 않는다
        setConn("disconnected");
        setConnError(err.message);
      }
    });
    socket.on("message:new", (m: ChatMessage) => merge([m]));
    socket.on("presence", ({ online }: { online: number }) => setOnline(online));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [nickname, merge]);

  function send(body: string, clientId = newClientId()) {
    const text = body.trim();
    if (!text) return;
    const socket = socketRef.current;
    forceScrollRef.current = true;

    const mark = (status: PendingMessage["status"], error?: string) =>
      setPending((prev) => {
        const rest = prev.filter((p) => p.clientId !== clientId);
        return [...rest, { clientId, author: nickname, body: text, status, error }];
      });

    if (!socket?.connected) {
      mark("failed", "연결이 끊겨 보내지 못했습니다");
      return;
    }
    mark("sending");
    socket.timeout(SEND_TIMEOUT_MS).emit(
      "message:send",
      { clientId, body: text },
      (err: Error | null, res: SendAck) => {
        if (err) return mark("failed", "서버 응답이 없습니다");
        if (!res.ok) return mark("failed", res.error);
        merge([res.message]);
      },
    );
  }

  function submit() {
    if (!draft.trim()) return;
    send(draft);
    setDraft("");
  }

  function discard(clientId: string) {
    setPending((prev) => prev.filter((p) => p.clientId !== clientId));
  }

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
    if (stickToBottomRef.current || forceScrollRef.current) {
      scrollToBottom();
      forceScrollRef.current = false;
    } else {
      setHasUnseen(true);
    }
  }, [messages, pending]);

  const canSend = draft.trim().length > 0;

  return (
    <div className="chat">
      <header className="chat-header">
        <div>
          <h1># 일반</h1>
          {conn === "connected" && <span className="muted">접속 {online}명</span>}
        </div>
        <div className="header-right">
          <span className={`conn conn-${conn}`} title={connError ?? undefined}>
            <span className="dot" />
            {CONNECTION_LABEL[conn]}
          </span>
          <span className="me">{nickname}</span>
          <button className="link" onClick={onLeave}>
            나가기
          </button>
        </div>
      </header>

      <p className="notice">임시 서버입니다. 서버를 다시 시작하면 대화가 사라집니다.</p>
      {connError && conn !== "connected" && <p className="notice error">{connError}</p>}
      {serverRestarted && (
        <p className="notice error">
          서버가 다시 시작되어 이전 대화가 지워졌습니다.{" "}
          <button className="link" onClick={() => setServerRestarted(false)}>
            닫기
          </button>
        </p>
      )}

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 && pending.length === 0 && (
          <p className="empty muted">아직 메시지가 없습니다. 첫 메시지를 보내 보세요.</p>
        )}
        {messages.map((m) => (
          <article key={m.id} className={`msg ${m.author === nickname ? "mine" : ""}`}>
            <div className="msg-meta">
              <strong>{m.author}</strong>
              <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
            </div>
            <p className="msg-body">{m.body}</p>
          </article>
        ))}
        {pending.map((p) => (
          <article key={p.clientId} className={`msg mine ${p.status}`}>
            <div className="msg-meta">
              <strong>{p.author}</strong>
              <span>{p.status === "sending" ? "보내는 중…" : "전송 실패"}</span>
            </div>
            <p className="msg-body">{p.body}</p>
            {p.status === "failed" && (
              <div className="msg-actions">
                <span className="error-text">{p.error}</span>
                <button className="link" onClick={() => send(p.body, p.clientId)}>
                  다시 보내기
                </button>
                <button className="link" onClick={() => discard(p.clientId)}>
                  삭제
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {hasUnseen && (
        <button className="unseen" onClick={scrollToBottom}>
          새 메시지 ↓
        </button>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          rows={1}
          placeholder="#일반 에 메시지 보내기 (Enter 전송, Shift+Enter 줄바꿈)"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중 Enter 는 조합 확정이므로 전송하지 않는다 (두 번 전송 방지)
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" disabled={!canSend}>
          전송
        </button>
      </form>
    </div>
  );
}
