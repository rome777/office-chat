"use client";

// 공통 틀 — 세 영역이 함께 쓰는 화면 상태. 각자 읽고 바꾸기만 하고, 이 파일은 고치지 않는다.
// 새 상태가 필요하면 자기 영역 안에서 만들고, 정말 공유해야 할 때만 팀에 알리고 추가한다.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Channel } from "@/lib/types/channel";
import type { ConnectionState } from "@/lib/types/message";

/** 오른쪽 패널에 열린 것. null 이면 닫힘 */
export type PanelState =
  | { kind: "thread"; messageId: number } // ① 스레드
  | { kind: "summary" } // ③ AI 요약
  | { kind: "todos" } // ③ AI 할 일
  | { kind: "channelInfo" } // ③ 채널 정보(멤버·내보내기·관리 기록)
  | { kind: "orgChart" }; // ③ 조직도 (부서 채널이면 그 부서만)

export type Me = { name: string };

type Workspace = {
  me: Me;
  signOut: () => void;
  /** 지금 보고 있는 대화. ③ 알림은 이것으로 "보고 있는 대화의 메시지"를 거른다 */
  channel: Channel;
  setChannel: (c: Channel) => void;
  panel: PanelState | null;
  openPanel: (p: PanelState) => void;
  closePanel: () => void;
  /** ① 메시지 구독이 채우고, 헤더의 연결 상태 표시가 읽는다 */
  connection: { state: ConnectionState; online: number };
  setConnection: (c: { state: ConnectionState; online: number }) => void;
};

const WorkspaceContext = createContext<Workspace | null>(null);

// 채널 목록이 생기기 전까지는 #일반 만 쓴다. 채널 목록이 생기면 ② 가 setChannel 로 바꾼다.
// id 는 DB 의 #일반 채널 id 다 (supabase/migrations/20260929100100_step1_compat.sql 에서 고정, 모든 사람이 멤버)
const DEFAULT_CHANNEL: Channel = { id: "00000000-0000-0000-0000-000000000001", name: "일반" };

export function WorkspaceProvider({
  me,
  signOut,
  children,
}: {
  me: Me;
  signOut: () => void;
  children: ReactNode;
}) {
  const [channel, setChannel] = useState<Channel>(DEFAULT_CHANNEL);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [connection, setConnection] = useState<Workspace["connection"]>({
    state: "connecting",
    online: 0,
  });

  const value = useMemo<Workspace>(
    () => ({
      me,
      signOut,
      channel,
      setChannel,
      panel,
      openPanel: setPanel,
      closePanel: () => setPanel(null),
      connection,
      setConnection,
    }),
    [me, signOut, channel, panel, connection],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace 는 WorkspaceProvider 안에서만 쓸 수 있습니다");
  return ctx;
}
