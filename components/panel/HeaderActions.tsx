"use client";

// ③ 채팅 머리 "⋯" 안의 패널 버튼 (요약·할 일·잡무·채널 정보) + 조직도.
// 조직도는 2026-09-30 부터 패널이 아니라 페이지(/org)다 — 이 채널의 부서를 고른 채 연다.

import { useRouter } from "next/navigation";
import { useWorkspace, type PanelState } from "@/components/workspace/WorkspaceContext";
import s from "./panel.module.css";

const BUTTONS: { kind: Exclude<PanelState["kind"], "thread">; label: string }[] = [
  { kind: "summary", label: "요약" },
  { kind: "todos", label: "할 일" },
  { kind: "chores", label: "잡무" },
  { kind: "channelInfo", label: "채널 정보" },
];

export default function HeaderActions() {
  const { channel, panel, openPanel, closePanel } = useWorkspace();
  const router = useRouter();
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
      <button className={s.action} onClick={() => router.push(`/org?channel=${encodeURIComponent(channel.id)}`)}>
        조직도
      </button>
    </span>
  );
}
