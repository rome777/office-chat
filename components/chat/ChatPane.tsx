"use client";

// ① 가운데 칸 = 메시지 목록 + 입력창

import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useMessages } from "./useMessages";
import MessageList from "./MessageList";
import Composer from "./Composer";
import s from "./chat.module.css";

export default function ChatPane() {
  const { me, channel, setConnection } = useWorkspace();
  const { messages, pending, conn, online, fatal, send, discard } = useMessages(me.name);
  const [sendTick, setSendTick] = useState(0);

  // 헤더의 연결 상태 표시(①)가 화면 상태에서 읽는다
  useEffect(() => {
    setConnection({ state: conn, online });
  }, [conn, online, setConnection]);

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
      <p className={s.notice}>
        테스트 버전입니다. 로그인 없이 누구나 읽고 쓸 수 있으니 중요한 내용은 쓰지 마세요.
      </p>
      <MessageList
        messages={messages}
        pending={pending}
        me={me.name}
        sendTick={sendTick}
        onRetry={(p) => sendNow(p.body, p.clientId)}
        onDiscard={discard}
      />
      <Composer channelName={channel.name} onSend={(body) => sendNow(body)} />
    </section>
  );
}
