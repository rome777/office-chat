"use client";

// ③ AI 요약 패널. 결과는 ① 의 SafeText 로 그리고, 원문 링크는 ?m=<메시지 id> 로 건다 (① 이 이동·강조).
// AI 가 실패해도 채팅은 그대로다. 오류 문구만 여기 보여 준다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import SafeText from "@/components/chat/SafeText";
import s from "./panel.module.css";

type Item = { text: string; message_ids: number[] };
type Result = { items: Item[]; range: { kind: "unread" | "recent"; count: number; from_id?: number; to_id?: number }; note?: string };

export default function SummaryPanel() {
  const router = useRouter();
  const { channel } = useWorkspace();
  const [state, setState] = useState<
    { status: "idle" } | { status: "loading"; label: string } | { status: "done"; result: Result; channelId: string } | { status: "error"; error: string }
  >({ status: "idle" });

  async function summarize(range: "unread" | "recent") {
    const label = range === "unread" ? "안 읽은 메시지" : "최근 50건";
    setState({ status: "loading", label });
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channel.id, range, limit: 50 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setState({ status: "error", error: data.error ?? "요약하지 못했습니다" });
      setState({ status: "done", result: data as Result, channelId: channel.id });
    } catch {
      setState({ status: "error", error: "서버에 연결하지 못했습니다" });
    }
  }

  const stale = state.status === "done" && state.channelId !== channel.id;

  return (
    <div className={s.summary}>
      <p className="muted">{channel.type === "dm" ? `@${channel.name}` : `#${channel.name}`} 대화를 AI 가 요약합니다. 항목마다 근거 메시지로 갈 수 있습니다.</p>
      <div className={s.summaryButtons}>
        <button className={s.action} onClick={() => void summarize("unread")} disabled={state.status === "loading"}>
          안 읽은 것 요약
        </button>
        <button className={s.action} onClick={() => void summarize("recent")} disabled={state.status === "loading"}>
          최근 50건 요약
        </button>
      </div>

      {state.status === "loading" && <p className="muted">{state.label}을 요약하는 중… (최대 20초)</p>}
      {state.status === "error" && <p className="error-text">{state.error}</p>}
      {state.status === "done" && (
        <>
          {stale && <p className="muted">다른 채널의 요약입니다. 이 채널을 요약하려면 다시 누르세요.</p>}
          {state.result.range.count > 0 && (
            <p className={`${s.summaryRange} muted`}>
              메시지 {state.result.range.count}건 (#{state.result.range.from_id} ~ #{state.result.range.to_id})
            </p>
          )}
          {state.result.note && <p className="muted">{state.result.note}</p>}
          <ul className={s.summaryList}>
            {state.result.items.map((item, i) => (
              <li key={i}>
                <SafeText text={item.text} />
                <span className={s.sources}>
                  {item.message_ids.map((id) => (
                    <button key={id} className="link" onClick={() => router.push(`/?m=${id}`)} title={`메시지 #${id} 로 이동`}>
                      원문 #{id}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
