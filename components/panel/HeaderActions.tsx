"use client";

// ③ 채팅 머리 "⋯" 안의 패널 버튼 (요약·할 일·잡무·채널 정보).
// 조직도는 2026-09-30 부터 왼쪽 메뉴의 페이지(/org)로만 연다 — 메시지 화면에는 두지 않는다 (사용자 결정).

import { useWorkspace, type PanelState } from "@/components/workspace/WorkspaceContext";
import s from "./panel.module.css";

// 값 없이 여는 대화 패널만 (일정 패널 등 값이 필요한 종류가 늘어도 여기엔 안 들어온다)
const BUTTONS: { kind: Extract<PanelState, { kind: "summary" | "todos" | "chores" | "channelInfo" }>["kind"]; label: string }[] = [
  { kind: "summary", label: "요약" },
  { kind: "todos", label: "할 일" },
  { kind: "chores", label: "잡무" },
  { kind: "channelInfo", label: "채널 정보" },
];

export default function HeaderActions() {
  const { panel, openPanel, closePanel } = useWorkspace();
  return (
    <span className={s.actions}>
      {BUTTONS.map((b) => {
        const open = panel?.kind === b.kind;
        return (
          <button
            key={b.kind}
            className={`${s.action} ${open ? s.on : ""}`}
            aria-pressed={open}
            onClick={() => (open ? closePanel() : openPanel({ kind: b.kind }))}
          >
            {b.label}
          </button>
        );
      })}
    </span>
  );
}
