"use client";

// ③ 채널 정보 패널 (멤버·내보내기·관리 기록). 멤버 추가는 ② 의 사람 찾기를 가져다 쓴다.
// 버튼은 관리자에게만 보이지만, 실제 권한은 DB 정책(RLS)이 검사한다 (TECH_SPEC 5절, npm run check:db 로 확인).
// 남을 넣고 빼면 트리거가 admin_logs 에 남긴다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useChannelMembers } from "@/components/chat/useChannelMembers";
import { useSelf } from "@/components/chat/useSelf";
import PeoplePicker from "@/components/people/PeoplePicker";
import type { Person } from "@/lib/types/people";
import { getSupabase } from "@/lib/supabase";
import s from "./panel.module.css";

const GENERAL = "00000000-0000-0000-0000-000000000001"; // 모두가 들어가는 #일반 (나가기 없음)
const TYPE_LABEL: Record<string, string> = { public: "공개 채널", private: "비공개 채널", dm: "DM" };

type Log = { id: number; action: string; actor_id: string | null; target: { channel_id?: string; user_id?: string }; created_at: string };

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export default function ChannelInfoPanel() {
  const { channel } = useWorkspace();
  const self = useSelf();
  const members = useChannelMembers(channel.id);
  const [type, setType] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<Log[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const isAdmin = !!self && roles[self.id] === "admin";
  const manageable = isAdmin && type !== null && type !== "dm";
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);

  // 채널 종류와 멤버·나의 역할 (관리자 표시와 버튼에 쓴다)
  useEffect(() => {
    let alive = true;
    const supabase = getSupabase();
    void supabase
      .from("channels")
      .select("type")
      .eq("id", channel.id)
      .maybeSingle()
      .then(({ data }) => alive && setType(data?.type ?? null));
    const ids = [...new Set([...memberIds, ...(self ? [self.id] : [])])];
    if (ids.length) {
      void supabase
        .from("profiles")
        .select("id, role")
        .in("id", ids)
        .then(({ data }) => alive && setRoles(Object.fromEntries((data ?? []).map((p) => [p.id, p.role]))));
    }
    return () => {
      alive = false;
    };
  }, [channel.id, memberIds, self]);

  // 관리 기록은 관리자만 볼 수 있다 (RLS). 이 채널 것만
  const loadLogs = useCallback(async () => {
    if (!isAdmin) return setLogs([]);
    const supabase = getSupabase();
    const { data } = await supabase
      .from("admin_logs")
      .select("id, action, actor_id, target, created_at")
      .eq("target->>channel_id", channel.id)
      .order("id", { ascending: false })
      .limit(30);
    const list = (data ?? []) as Log[];
    setLogs(list);
    const ids = [...new Set(list.flatMap((l) => [l.actor_id, l.target.user_id]).filter((v): v is string => !!v))];
    if (ids.length) {
      const { data: people } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.display_name])));
    }
  }, [channel.id, isAdmin]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs, members.length]);

  async function remove(userId: string, name: string) {
    if (!window.confirm(`${name} 님을 #${channel.name} 에서 내보낼까요?`)) return;
    setBusy(true);
    const { data, error } = await getSupabase()
      .from("memberships")
      .delete()
      .eq("channel_id", channel.id)
      .eq("user_id", userId)
      .select("user_id");
    setBusy(false);
    // 권한이 없으면 RLS 가 0건을 지운다 (오류가 아니라 빈 결과)
    if (error || !data?.length) return setMessage({ kind: "error", text: "내보내지 못했습니다. 관리자만 할 수 있습니다" });
    setMessage({ kind: "ok", text: `${name} 님을 내보냈습니다` });
  }

  async function addMembers() {
    if (adding.length === 0) return;
    setBusy(true);
    const { error } = await getSupabase()
      .from("memberships")
      .insert(adding.map((p) => ({ channel_id: channel.id, user_id: p.id })));
    setBusy(false);
    if (error) return setMessage({ kind: "error", text: `추가하지 못했습니다: ${error.message}` });
    setMessage({ kind: "ok", text: `${adding.map((p) => p.display_name).join(", ")} 님을 추가했습니다` });
    setAdding([]);
  }

  async function leave() {
    if (!self || !window.confirm(`#${channel.name} 에서 나갈까요?`)) return;
    const { error } = await getSupabase().from("memberships").delete().eq("channel_id", channel.id).eq("user_id", self.id);
    if (error) setMessage({ kind: "error", text: `나가지 못했습니다: ${error.message}` });
    // 보던 채널에서 빠지면 채널 목록(②)이 #일반 으로 돌려보낸다
  }

  return (
    <div className={s.info}>
      <section>
        <h3 className={s.infoTitle}>
          {type === "dm" ? "DM" : `#${channel.name}`}
          {type && <span className="muted"> · {TYPE_LABEL[type] ?? type}</span>}
        </h3>
        {message && <p className={message.kind === "error" ? "error-text" : "muted"}>{message.text}</p>}
      </section>

      <section>
        <h4 className={s.infoHead}>멤버 {members.length}명</h4>
        <ul className={s.memberList}>
          {members.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.display_name}</strong> <span className="muted">@{m.handle}</span>
                {m.department && <span className="muted"> · {m.department}</span>}
                {roles[m.id] === "admin" && <span className={s.adminBadge}>관리자</span>}
                {self?.id === m.id && <span className="muted"> (나)</span>}
              </span>
              {manageable && self?.id !== m.id && (
                <button className="link" disabled={busy} onClick={() => void remove(m.id, m.display_name)}>
                  내보내기
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {manageable && (
        <section>
          <h4 className={s.infoHead}>멤버 추가 (관리자)</h4>
          <PeoplePicker value={adding} onChange={setAdding} exclude={memberIds} />
          <button className={s.action} disabled={busy || adding.length === 0} onClick={() => void addMembers()}>
            추가하기
          </button>
        </section>
      )}

      {isAdmin && (
        <section>
          <h4 className={s.infoHead}>관리 기록</h4>
          {logs.length === 0 ? (
            <p className="muted">이 채널의 관리 기록이 없습니다</p>
          ) : (
            <ul className={s.logList}>
              {logs.map((l) => (
                <li key={l.id}>
                  <time className="muted">{formatWhen(l.created_at)}</time>{" "}
                  {names[l.actor_id ?? ""] ?? "알 수 없음"} 님이 {names[l.target.user_id ?? ""] ?? "알 수 없음"} 님을{" "}
                  {l.action === "remove_member" ? "내보냄" : l.action === "add_member" ? "추가함" : l.action}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {type !== "dm" && channel.id !== GENERAL && (
        <section>
          <button className="link" onClick={() => void leave()}>
            이 채널에서 나가기
          </button>
        </section>
      )}
    </div>
  );
}
