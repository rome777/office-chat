"use client";

// 공통 틀 — 세 영역이 함께 쓰는 화면 상태. 각자 읽고 바꾸기만 하고, 이 파일은 고치지 않는다.
// 새 상태가 필요하면 자기 영역 안에서 만들고, 정말 공유해야 할 때만 팀에 알리고 추가한다.

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Channel } from "@/lib/types/channel";
import type { ConnectionState } from "@/lib/types/message";

/** 오른쪽 패널에 열린 것. null 이면 닫힘 */
export type PanelState =
  | { kind: "thread"; messageId: number } // ① 스레드
  | { kind: "summary" } // ③ AI 요약
  | { kind: "todos" } // ③ AI 할 일
  | { kind: "channelInfo" } // ③ 채널 정보(멤버·내보내기·관리 기록)
  | { kind: "chores" } // ③ 잡무 수첩 (2026-09-29)
  | { kind: "profile" }; // ② 내 프로필 (2026-09-30, 헤더의 내 이름 메뉴에서 연다)

/** 나에게 딸린 패널 — 어느 페이지에서나 열려 있다. 나머지는 대화에 딸린 패널이라
 *  채널을 바꾸거나 /chat 을 떠나면 닫힌다 (2026-09-30, 다른 채널·캘린더 옆에 남던 것을 고침) */
const GLOBAL_PANELS: ReadonlySet<PanelState["kind"]> = new Set(["profile"]);
const keepGlobal = (p: PanelState | null) => (p && GLOBAL_PANELS.has(p.kind) ? p : null);

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
  const [channel, setChannelState] = useState<Channel>(DEFAULT_CHANNEL);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const channelId = useRef(DEFAULT_CHANNEL.id);
  const pathname = usePathname();

  // 다른 대화로 옮기면 대화 패널을 닫는다. 이름만 바뀐 것(같은 id)은 그대로 둔다
  const setChannel = useCallback((c: Channel) => {
    if (c.id !== channelId.current) {
      channelId.current = c.id;
      setPanel(keepGlobal);
    }
    setChannelState(c);
  }, []);

  // 채팅 화면을 떠나면 대화 패널을 닫는다 (돌아와도 다시 열지 않는다 — 2026-09-30 사용자 결정)
  useEffect(() => {
    if (!pathname.startsWith("/chat")) setPanel(keepGlobal);
  }, [pathname]);
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
    [me, signOut, channel, setChannel, panel, connection],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace 는 WorkspaceProvider 안에서만 쓸 수 있습니다");
  return ctx;
}
