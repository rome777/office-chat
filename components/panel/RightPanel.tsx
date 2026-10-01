"use client";

// ③ 오른쪽 패널 틀. 무엇이 열렸는지(화면 상태의 panel)에 따라 내용을 바꿔 그린다.
// 스레드는 ① 의 ThreadPanel 을, 나머지는 ③ 의 패널을 그린다. 새 패널 종류가 생기면 여기에 한 줄 추가한다.

import ThreadPanel from "@/components/chat/ThreadPanel";
import ProfilePanel from "@/components/profile/ProfilePanel"; // ② 내 프로필 (2026-09-30)
import EventEditor from "@/components/calendar/EventEditor"; // ② 일정 만들기·고치기 (2026-09-30)
import EventPanel, { TeamEventPanel } from "@/components/calendar/EventPanel"; // ② 일정 상세·팀원 일정
import { useWorkspace, type PanelState } from "@/components/workspace/WorkspaceContext";
import ChannelInfoPanel from "./ChannelInfoPanel";
import ChoresPanel from "./ChoresPanel";
import SummaryPanel from "./SummaryPanel";
import TodosPanel from "./TodosPanel";
import s from "./panel.module.css";

const TITLE: Record<PanelState["kind"], string> = {
  thread: "스레드",
  summary: "AI 요약",
  todos: "AI 할 일",
  channelInfo: "채널 정보",
  chores: "잡무 수첩",
  profile: "내 프로필",
  event: "일정 상세",
  eventNew: "일정 만들기",
  eventEdit: "일정 고치기",
  teamEvent: "팀원 일정",
};

function PanelBody({ panel }: { panel: PanelState }) {
  switch (panel.kind) {
    case "thread":
      return <ThreadPanel messageId={panel.messageId} />;
    case "summary":
      return <SummaryPanel />;
    case "todos":
      return <TodosPanel />;
    case "channelInfo":
      return <ChannelInfoPanel />;
    case "chores":
      return <ChoresPanel />;
    case "profile":
      return <ProfilePanel />;
    case "event":
      return <EventPanel eventId={panel.eventId} />;
    case "eventNew":
      return <EventEditor mode="new" date={panel.date} time={panel.time} withIds={panel.withIds} fromMessage={panel.fromMessage} />;
    case "eventEdit":
      return <EventEditor mode="edit" eventId={panel.eventId} />;
    case "teamEvent":
      return <TeamEventPanel {...panel} />;
  }
}

export default function RightPanel() {
  const { panel, closePanel } = useWorkspace();
  if (!panel) return null;
  return (
    <aside className={s.panel} aria-label={TITLE[panel.kind]}>
      <header className={s.head}>
        <h2>{TITLE[panel.kind]}</h2>
        <button className="link" onClick={closePanel} aria-label="패널 닫기">
          닫기
        </button>
      </header>
      <div className={s.content}>
        <PanelBody panel={panel} />
      </div>
    </aside>
  );
}
