"use client";

// ③ 채팅 머리 "⋯" 안의 패널 버튼 (요약·할 일·잡무·채널 정보).
// 조직도는 2026-09-30 부터 왼쪽 메뉴의 페이지(/org)로만 연다 — 메시지 화면에는 두지 않는다 (사용자 결정).

import { useWorkspace, type PanelState } from "@/components/workspace/WorkspaceContext";
import s from "./panel.module.css";

const BUTTONS: { kind: Exclude<PanelState["kind"], "thread">; label: string }[] = [
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
