"use client";

// ① 헤더에 들어가는 연결 상태 (F1-4)
// 연결이 흔들릴 때만 보인다 — 재연결 중(노랑)·끊김(빨강) 알약. 연결됨·처음 연결 중에는 아무것도 없다 (2026-09-30 ② 김송이, 사용자 결정).
// 접속 인원은 여기서 세지 않는다: 채널 헤더의 "총인원 · 접속 N명"(② ChannelTitle)이 사람 수로 센다 (이 구독의 접속자 수는 탭 수였다).
// 처음 연결이 실패해도 CHANNEL_ERROR → 재연결 중으로 바뀌므로, 연결 중을 숨겨도 문제를 놓치지 않는다.

import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import s from "./chat.module.css";

export default function ConnectionStatus() {
  const { connection } = useWorkspace();
  const { state } = connection;
  return (
    // 알약이 생기고 없어질 때 화면 읽기가 읽어 준다 (알림 칸이라 비어 있어도 숨기지 않는다)
    <span role="status" aria-live="polite">
      {state === "reconnecting" && <span className={`${s.conn} ${s.reconnecting}`}>재연결 중…</span>}
      {state === "disconnected" && <span className={`${s.conn} ${s.disconnected}`}>끊김 · 메시지가 안 갈 수 있어요</span>}
    </span>
  );
}
