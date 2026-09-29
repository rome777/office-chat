"use client";

// ① 헤더에 들어가는 연결 상태 (F1-4)

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
  const { connection } = useWorkspace();
  return (
    <span className={`${s.conn} ${s[connection.state] ?? ""}`}>
      <span className={s.dot} />
      {LABEL[connection.state]}
      {connection.state === "connected" && <span className="muted"> · 접속 {connection.online}명</span>}
    </span>
  );
}
