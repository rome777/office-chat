"use client";

// ① 가운데 칸 = 메시지 목록 + 입력창

import { Suspense, useEffect, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useMessages } from "./useMessages";
import MessageList, { type Focus } from "./MessageList";
import Composer from "./Composer";
import JumpToMessage from "./JumpToMessage";
import s from "./chat.module.css";

const NOTICE_MS = 4000;

export default function ChatPane() {
  const { me, channel, setConnection } = useWorkspace();
  const {
    messages,
    pending,
    conn,
    online,
    fatal,
    self,
    names,
    ready,
    hasOlder,
    loadingOlder,
    send,
    discard,
    loadOlder,
    reveal,
  } = useMessages(channel.id, me.name);
  const [sendTick, setSendTick] = useState(0);
  // 주소로 받은 이동 요청. 처음 불러오기가 끝난 뒤에 처리한다
  const [jumpTarget, setJumpTarget] = useState<number | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [jumpNotice, setJumpNotice] = useState<string | null>(null);

  // 헤더의 연결 상태 표시(①)가 화면 상태에서 읽는다
  useEffect(() => {
    setConnection({ state: conn, online });
  }, [conn, online, setConnection]);

  useEffect(() => {
    if (!ready || jumpTarget === null) return;
    const id = jumpTarget;
    setJumpTarget(null);
    void reveal(id).then((ok) => {
      if (ok) setFocus((f) => ({ id, seq: (f?.seq ?? 0) + 1 }));
      else setJumpNotice("메시지를 불러오지 못했습니다. 연결을 확인해 주세요.");
    });
  }, [ready, jumpTarget, reveal]);

  useEffect(() => {
    if (!jumpNotice) return;
    const timer = setTimeout(() => setJumpNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [jumpNotice]);

  function sendNow(body: string, clientId?: string) {
    setSendTick((t) => t + 1);
    void send(body, clientId);
  }

  if (fatal) {
    return (
      <section className={s.pane}>
        <p className={`${s.notice} error-text`}>{fatal}</p>
      </section>
    );
  }

  return (
    <section className={s.pane}>
      <Suspense fallback={null}>
        <JumpToMessage onJump={setJumpTarget} />
      </Suspense>
      {jumpNotice && <p className={`${s.notice} error-text`}>{jumpNotice}</p>}
      <MessageList
        messages={messages}
        pending={pending}
        self={self}
        names={names}
        sendTick={sendTick}
        hasOlder={hasOlder}
        loadingOlder={loadingOlder}
        focus={focus}
        onLoadOlder={() => void loadOlder()}
        onFocusMissing={() => setJumpNotice("메시지를 찾을 수 없습니다. 지워졌거나 볼 수 없는 메시지입니다.")}
        onRetry={(p) => sendNow(p.body, p.clientId)}
        onDiscard={discard}
      />
      <Composer channelName={channel.name} onSend={(body) => sendNow(body)} />
    </section>
  );
}
