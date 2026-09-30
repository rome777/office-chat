"use client";

// ① 헤더에 들어가는 연결 상태 (F1-4)
// DM 에서는 연결됐을 때 숨긴다 — 1:1 이라 접속자 수(탭 수를 센다)가 뜻이 없고, 옆에 상대 상태(② ChannelTitle)가 있다.
// 연결 중·재연결 중·끊김은 DM 에서도 보인다 (2026-09-30 ② 김송이)

import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import type { ConnectionState } from "@/lib/types/message";
import s from "./chat.module.css";

const LABEL: Record<ConnectionState, string> = {
  connecting: "연결 중",
  connected: "연결됨",
  reconnecting: "재연결 중",
  disconnected: "끊김",
};

export default function ConnectionStatus() {
  const { connection, channel } = useWorkspace();
  if (channel.type === "dm" && connection.state === "connected") return null;
  return (
    <span className={`${s.conn} ${s[connection.state] ?? ""}`}>
      <span className={s.dot} />
      {LABEL[connection.state]}
      {connection.state === "connected" && <span className="muted"> · 접속 {connection.online}명</span>}
    </span>
  );
}
