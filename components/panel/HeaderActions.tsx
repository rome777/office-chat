"use client";

// ③ 헤더 오른쪽의 패널 버튼 (요약·할 일·잡무·채널 정보·조직도)

import { useWorkspace, type PanelState } from "@/components/workspace/WorkspaceContext";
import s from "./panel.module.css";

const BUTTONS: { kind: Exclude<PanelState["kind"], "thread">; label: string }[] = [
  { kind: "summary", label: "요약" },
  { kind: "todos", label: "할 일" },
  { kind: "chores", label: "잡무" },
  { kind: "channelInfo", label: "채널 정보" },
  { kind: "orgChart", label: "조직도" },
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
