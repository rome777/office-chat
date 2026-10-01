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
  | { kind: "profile" } // ② 내 프로필 (2026-09-30, 헤더의 내 이름 메뉴에서 연다)
  // ② 일정 (2026-09-30 일정 개편) — 상세·만들기·고치기·팀원 일정. /calendar 를 떠나면 닫힌다
  | { kind: "event"; eventId: string }
  | { kind: "eventNew"; date: string; time?: string; withIds?: string[]; fromMessage?: number }
  | { kind: "eventEdit"; eventId: string }
  // ② 회의실 예약 (2026-10-01 개편) — 예약·예약 고치기(eventId), 남의 예약 정보. /rooms 를 떠나면 닫힌다.
  //   roomBook 의 회의실·날짜·시각은 시간표와 패널이 같이 쓴다 (시간표 빈 칸을 누르면 이 값만 바뀌고 패널의 다른 입력은 남는다)
  | { kind: "roomBook"; roomId: string; date: string; start: string; end: string; eventId?: string }
  | {
      kind: "roomSlot";
      roomId: string;
      startsAt: string;
      endsAt: string;
      isPrivate: boolean;
      bookerId: string | null;
      bookerName: string | null;
      bookerUnit: string | null;
    }
  | {
      kind: "teamEvent";
      name: string;
      userId: string;
      eventKind: "work" | "personal" | "outside" | "leave" | null;
      label: string;
      title: string | null;
      location: string | null;
      assignees: string[];
      startsAt: string;
      endsAt: string;
      allDay: boolean;
    };

/** 나에게 딸린 패널 — 어느 페이지에서나 열려 있다. 나머지는 대화에 딸린 패널이라
 *  채널을 바꾸거나 /chat 을 떠나면 닫힌다 (2026-09-30, 다른 채널·캘린더 옆에 남던 것을 고침) */
const GLOBAL_PANELS: ReadonlySet<PanelState["kind"]> = new Set(["profile"]);
const keepGlobal = (p: PanelState | null) => (p && GLOBAL_PANELS.has(p.kind) ? p : null);
/** 페이지에 딸린 패널 — 그 페이지를 떠나면 닫힌다. 적지 않은 것은 대화 패널(/chat) */
const PAGE_OF: Partial<Record<PanelState["kind"], string[]>> = {
  // 일정 상세·고치기는 회의실 예약(/rooms)의 "내 예약"에서도 연다 (2026-10-01)
  event: ["/calendar", "/rooms"],
  eventNew: ["/calendar"],
  eventEdit: ["/calendar", "/rooms"],
  teamEvent: ["/calendar"],
  roomBook: ["/rooms"],
  roomSlot: ["/rooms"],
};
/** 패널을 연 페이지("/calendar" 등)에 그대로 있을 때만 남긴다 — 일정 상세는 두 페이지에서 열리지만, 일정에서 연 것이 회의실 예약으로 따라오지 않게 */
const keepOn = (pathname: string, openedOn: string) => (p: PanelState | null) =>
  p &&
  (GLOBAL_PANELS.has(p.kind) ||
    ((PAGE_OF[p.kind] ?? ["/chat"]).some((page) => pathname.startsWith(page)) && pathname.startsWith(openedOn)))
    ? p
    : null;
const pageOf = (pathname: string) => `/${pathname.split("/")[1] ?? ""}`;

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
  const openedOn = useRef("/");
  // 지금 주소에서 읽는다 — 새 페이지의 effect 가 이 Provider 의 effect 보다 먼저 돌아서 pathname 상태는 아직 예전 값일 수 있다
  const openPanel = useCallback((p: PanelState) => {
    openedOn.current = pageOf(window.location.pathname);
    setPanel(p);
  }, []);

  // 다른 대화로 옮기면 대화 패널을 닫는다. 이름만 바뀐 것(같은 id)은 그대로 둔다
  const setChannel = useCallback((c: Channel) => {
    if (c.id !== channelId.current) {
      channelId.current = c.id;
      setPanel(keepGlobal);
    }
    setChannelState(c);
  }, []);

  // 페이지를 떠나면 그 페이지의 패널을 닫는다 — 채팅 화면의 대화 패널, 일정 화면의 일정 패널
  // (돌아와도 다시 열지 않는다 — 2026-09-30 사용자 결정)
  useEffect(() => {
    setPanel(keepOn(pathname, openedOn.current));
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
      openPanel,
      closePanel: () => setPanel(null),
      connection,
      setConnection,
    }),
    [me, signOut, channel, setChannel, panel, openPanel, connection],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace 는 WorkspaceProvider 안에서만 쓸 수 있습니다");
  return ctx;
}
