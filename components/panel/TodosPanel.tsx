"use client";

// ③ AI 할 일 패널. 근거 링크는 ?m=<메시지 id> 로 건다.
// AI 가 준 것은 "제안"이다. 사용자가 "저장"을 눌러야 todos 에 들어간다 (승인 후 실행, TECH_SPEC 8절 규칙 5).
// 담당자·기한이 대화에 없으면 서버가 null 로 돌려주고, 여기서는 "미정"으로 보여 준다.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useSelf } from "@/components/chat/useSelf";
import SafeText from "@/components/chat/SafeText";
import { getSupabase } from "@/lib/supabase";
import s from "./panel.module.css";

type Suggestion = {
  task: string;
  assignee_id: string | null;
  assignee_name: string | null;
  due: string | null;
  due_quote: string | null;
  evidence_message_id: number;
};
type Saved = {
  id: string;
  task: string;
  assignee: string | null;
  due: string | null;
  evidence_message_id: number | null;
  created_by: string;
  done_at: string | null;
};

const dueLabel = (due: string | null) =>
  due ? new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", month: "numeric", day: "numeric", weekday: "short" }).format(new Date(`${due}T00:00:00Z`)) : "미정";

export default function TodosPanel() {
  const router = useRouter();
  const { channel } = useWorkspace();
  const self = useSelf();
  const [state, setState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "done"; items: Suggestion[]; note?: string } | { status: "error"; error: string }
  >({ status: "idle" });
  const [savedKeys, setSavedKeys] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState<Saved[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("todos")
      .select("id, task, assignee, due, evidence_message_id, created_by, done_at")
      .eq("channel_id", channel.id)
      .order("created_at", { ascending: false })
      .limit(100);
    const list = (data ?? []) as Saved[];
    setSaved(list);
    const ids = [...new Set(list.map((t) => t.assignee).filter((v): v is string => !!v))];
    if (ids.length) {
      const { data: people } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.display_name])));
    }
  }, [channel.id]);

  useEffect(() => {
    setState({ status: "idle" });
    setSavedKeys(new Set());
    void loadSaved();
  }, [loadSaved]);

  async function extract(range: "unread" | "recent") {
    setState({ status: "loading" });
    setSavedKeys(new Set());
    try {
      const res = await fetch("/api/ai/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channel.id, range, limit: 50 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setState({ status: "error", error: data.error ?? "할 일을 뽑지 못했습니다" });
      setState({ status: "done", items: data.items ?? [], note: data.note });
    } catch {
      setState({ status: "error", error: "서버에 연결하지 못했습니다" });
    }
  }

  // 승인: 이 버튼을 눌러야 저장된다. 저장한 사람은 기본값 auth.uid() 로 정해진다
  async function approve(item: Suggestion, index: number) {
    setError(null);
    const { error: e } = await getSupabase().from("todos").insert({
      channel_id: channel.id,
      task: item.task,
      assignee: item.assignee_id,
      due: item.due,
      evidence_message_id: item.evidence_message_id,
    });
    if (e) return setError(`저장하지 못했습니다: ${e.message}`);
    setSavedKeys((prev) => new Set(prev).add(index));
    void loadSaved();
  }

  async function toggleDone(t: Saved) {
    await getSupabase()
      .from("todos")
      .update({ done_at: t.done_at ? null : new Date().toISOString() })
      .eq("id", t.id);
    void loadSaved();
  }

  async function remove(t: Saved) {
    await getSupabase().from("todos").delete().eq("id", t.id);
    void loadSaved();
  }

  const go = (id: number | null) => id && router.push(`/chat?m=${id}`);

  return (
    <div className={s.summary}>
      <p className="muted">{channel.type === "dm" ? `@${channel.name}` : `#${channel.name}`} 대화에서 AI 가 할 일을 제안합니다. 저장을 눌러야 목록에 남습니다.</p>
      <div className={s.summaryButtons}>
        <button className={s.action} onClick={() => void extract("unread")} disabled={state.status === "loading"}>
          안 읽은 것에서 뽑기
        </button>
        <button className={s.action} onClick={() => void extract("recent")} disabled={state.status === "loading"}>
          최근 50건에서 뽑기
        </button>
      </div>

      {state.status === "loading" && <p className="muted">할 일을 찾는 중… (최대 20초)</p>}
      {state.status === "error" && <p className="error-text">{state.error}</p>}
      {error && <p className="error-text">{error}</p>}
      {state.status === "done" && (
        <section>
          <h4 className={s.infoHead}>AI 제안 {state.items.length}개</h4>
          {state.note && <p className="muted">{state.note}</p>}
          {state.items.length === 0 && !state.note && <p className="muted">할 일을 찾지 못했습니다</p>}
          <ul className={s.todoList}>
            {state.items.map((item, i) => (
              <li key={i} className={s.todoCard}>
                <strong>
                  <SafeText text={item.task} />
                </strong>
                <span className="muted">
                  담당 {item.assignee_name ?? "미정"} · 기한 {dueLabel(item.due)}
                  {item.due_quote && <> (“{item.due_quote}”)</>}
                </span>
                <span className={s.todoActions}>
                  <button className="link" onClick={() => go(item.evidence_message_id)}>
                    근거 #{item.evidence_message_id}
                  </button>
                  {savedKeys.has(i) ? (
                    <span className="muted">저장됨</span>
                  ) : (
                    <button className={s.action} onClick={() => void approve(item, i)}>
                      저장
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4 className={s.infoHead}>저장한 할 일 {saved.length}개</h4>
        {saved.length === 0 && <p className="muted">아직 없습니다</p>}
        <ul className={s.todoList}>
          {saved.map((t) => (
            <li key={t.id} className={`${s.todoCard} ${t.done_at ? s.todoDone : ""}`}>
              <label className={s.todoCheck}>
                <input type="checkbox" checked={!!t.done_at} onChange={() => void toggleDone(t)} />
                <SafeText text={t.task} />
              </label>
              <span className="muted">
                담당 {t.assignee ? (names[t.assignee] ?? "…") : "미정"} · 기한 {dueLabel(t.due)}
              </span>
              <span className={s.todoActions}>
                {t.evidence_message_id && (
                  <button className="link" onClick={() => go(t.evidence_message_id)}>
                    근거 #{t.evidence_message_id}
                  </button>
                )}
                {self?.id === t.created_by && (
                  <button className="link" onClick={() => void remove(t)}>
                    삭제
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
