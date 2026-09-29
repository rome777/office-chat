"use client";

// ③ 잡무 수첩 패널. 커피·점심처럼 반복되는 잡무를 채널마다 적어 두고(누가 무엇을, 어디서), 갈 때 꺼내 쓴다.
// 목록을 열면 사람별 기록이 보이고, 오늘 갈 사람만 체크하면 "주문 정리"가 만들어진다 → 복사하거나 채널에 올린다.
// 채널 멤버는 누구나 보고 고친다 (새로 온 사람도 채널에 들어오기만 하면 된다). 목록 삭제만 만든 사람·관리자.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useSelf } from "@/components/chat/useSelf";
import { useChannelMembers } from "@/components/chat/useChannelMembers";
import { newClientId } from "@/components/chat/useMessages";
import SafeText from "@/components/chat/SafeText";
import { getSupabase } from "@/lib/supabase";
import type { ChoreEntry, ChoreList } from "@/lib/types/chores";
import { byPerson, orderText } from "./choreOrder";
import s from "./panel.module.css";

const when = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(new Date(iso));

export default function ChoresPanel() {
  const { channel } = useWorkspace();
  const self = useSelf();
  const members = useChannelMembers(channel.id);
  const [lists, setLists] = useState<ChoreList[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"lists" | "people">("lists");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error: e } = await supabase
      .from("chore_lists")
      .select("id, channel_id, title, place, memo, created_by, updated_by, updated_at, chore_entries(id, list_id, person_name, detail, created_at)")
      .eq("channel_id", channel.id)
      .order("created_at")
      .order("created_at", { referencedTable: "chore_entries" });
    if (e) return setError(`수첩을 불러오지 못했습니다: ${e.message}`);
    const list = (data ?? []) as ChoreList[];
    setLists(list);
    const ids = [...new Set(list.map((l) => l.updated_by).filter((v): v is string => !!v))];
    if (ids.length) {
      const { data: people } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.display_name])));
    }
  }, [channel.id]);

  useEffect(() => {
    setLists(null);
    setOpenId(null);
    setCreating(false);
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!self) return;
    void getSupabase()
      .from("profiles")
      .select("role")
      .eq("id", self.id)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(data?.role === "admin"));
  }, [self]);

  /** 쓰기 한 번 → 실패하면 오류, 성공하면 다시 불러온다 */
  const run = useCallback(
    async (fail: string, op: PromiseLike<{ error: { message: string } | null }>) => {
      setError(null);
      const { error: e } = await op;
      if (e) {
        setError(`${fail}: ${e.message}`);
        return false;
      }
      await load();
      return true;
    },
    [load],
  );

  async function createList(v: ListValues) {
    const supabase = getSupabase();
    setError(null);
    const { data, error: e } = await supabase
      .from("chore_lists")
      .insert({ channel_id: channel.id, ...v })
      .select("id")
      .single();
    if (e) return setError(`목록을 만들지 못했습니다: ${e.message}`);
    setCreating(false);
    setOpenId(data.id);
    await load();
  }

  const people = useMemo(() => byPerson(lists ?? []), [lists]);
  const memberNames = useMemo(() => members.map((m) => m.display_name), [members]);
  const where = channel.type === "dm" ? `@${channel.name}` : `#${channel.name}`;

  return (
    <div className={s.summary}>
      <p className="muted">
        {where} 멤버가 함께 쓰는 수첩입니다. 커피·점심처럼 반복되는 잡무를 사람별로 적어 두면, 새로 온 사람도 여기만 보고 바로 처리할 수 있습니다.
      </p>

      <div className={s.summaryButtons}>
        <button className={`${s.action} ${view === "lists" ? s.on : ""}`} aria-pressed={view === "lists"} onClick={() => setView("lists")}>
          목록별
        </button>
        <button className={`${s.action} ${view === "people" ? s.on : ""}`} aria-pressed={view === "people"} onClick={() => setView("people")}>
          사람별
        </button>
        {view === "lists" && !creating && (
          <button className={s.action} onClick={() => setCreating(true)}>
            + 새 목록
          </button>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}
      {lists === null && !error && <p className="muted">불러오는 중…</p>}

      {view === "lists" && creating && (
        <ListForm submitLabel="만들기" onSubmit={createList} onCancel={() => setCreating(false)} />
      )}

      {view === "lists" && lists && lists.length === 0 && !creating && (
        <p className="muted">아직 목록이 없습니다. &quot;+ 새 목록&quot;으로 &quot;커피&quot;, &quot;점심&quot; 같은 목록을 만들어 보세요.</p>
      )}

      {view === "lists" && lists && (
        <ul className={s.todoList}>
          {lists.map((l) => (
            <ChoreCard
              key={l.id}
              list={l}
              open={openId === l.id}
              onToggle={() => setOpenId(openId === l.id ? null : l.id)}
              editorName={l.updated_by ? names[l.updated_by] : undefined}
              canDelete={isAdmin || (!!self && self.id === l.created_by)}
              memberNames={memberNames}
              channelId={channel.id}
              run={run}
            />
          ))}
        </ul>
      )}

      {view === "people" && lists && (
        <>
          {people.length === 0 && <p className="muted">아직 적어 둔 사람이 없습니다</p>}
          <ul className={s.todoList}>
            {people.map((p) => (
              <li key={p.name} className={s.todoCard}>
                <strong>
                  <SafeText text={p.name} />
                </strong>
                {p.items.map((it, i) => (
                  <span key={i}>
                    <span className="muted">
                      <SafeText text={it.list} />
                    </span>{" "}
                    <SafeText text={it.detail} />
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

type Run = (fail: string, op: PromiseLike<{ error: { message: string } | null }>) => Promise<boolean>;

function ChoreCard({
  list,
  open,
  onToggle,
  editorName,
  canDelete,
  memberNames,
  channelId,
  run,
}: {
  list: ChoreList;
  open: boolean;
  onToggle: () => void;
  editorName: string | undefined;
  canDelete: boolean;
  memberNames: string[];
  channelId: string;
  run: Run;
}) {
  const supabase = getSupabase();
  const [editing, setEditing] = useState(false);
  // 오늘 안 가는 사람 (기본은 모두 간다). 목록을 닫았다 열면 다시 모두
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [posted, setPosted] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSkip(new Set());
      setEditing(false);
      setPosted(null);
    }
  }, [open]);

  const going = list.chore_entries.filter((e) => !skip.has(e.id));
  const order = going.length ? orderText(list, going) : "";
  const tooLong = order.length > 2000; // messages.body 상한

  const toggleSkip = (id: string) =>
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function copy() {
    try {
      await navigator.clipboard.writeText(order);
      setPosted("복사했습니다");
    } catch {
      setPosted("복사하지 못했습니다. 글자를 직접 선택해 복사하세요");
    }
  }

  // 채널에 보통 메시지로 올린다 (보낸 사람은 나). 가운데 칸은 ① 의 메시지 구독으로 바로 보인다
  async function post() {
    setPosting(true);
    const { error: e } = await supabase.from("messages").insert({ client_id: newClientId(), channel_id: channelId, body: order });
    setPosting(false);
    setPosted(e ? `채널에 올리지 못했습니다: ${e.message}` : "채널에 올렸습니다");
  }

  return (
    <li className={s.todoCard}>
      <button className={s.choreHead} onClick={onToggle} aria-expanded={open}>
        <strong>
          <SafeText text={list.title} />
        </strong>
        <span className="muted">
          {list.chore_entries.length}명{list.place && <> · {list.place}</>}
        </span>
      </button>

      {open && (
        <div className={s.choreBody}>
          {editing ? (
            <ListForm
              initial={list}
              submitLabel="저장"
              onCancel={() => setEditing(false)}
              onSubmit={async (v) => {
                if (await run("목록을 고치지 못했습니다", supabase.from("chore_lists").update(v).eq("id", list.id))) setEditing(false);
              }}
            />
          ) : (
            <>
              {list.place && (
                <span>
                  <span className="muted">장소</span> <SafeText text={list.place} />
                </span>
              )}
              {list.memo && (
                <span className={s.choreMemo}>
                  <SafeText text={list.memo} />
                </span>
              )}
              <span className={`muted ${s.summaryRange}`}>
                {when(list.updated_at)} {editorName ?? "누군가"} 수정
              </span>
              <span className={s.todoActions}>
                <button className="link" onClick={() => setEditing(true)}>
                  장소·메모 고치기
                </button>
                {canDelete && (
                  <button
                    className="link"
                    onClick={() => {
                      if (confirm(`"${list.title}" 목록과 적어 둔 ${list.chore_entries.length}명을 모두 지웁니다`))
                        void run("목록을 지우지 못했습니다", supabase.from("chore_lists").delete().eq("id", list.id));
                    }}
                  >
                    목록 지우기
                  </button>
                )}
              </span>
            </>
          )}

          <h4 className={s.infoHead}>사람별 기록 — 체크한 사람만 주문 정리에 들어갑니다</h4>
          {list.chore_entries.length === 0 && <p className="muted">아직 없습니다. 아래에서 추가하세요</p>}
          <ul className={s.memberList}>
            {list.chore_entries.map((e) => (
              <EntryRow key={e.id} entry={e} going={!skip.has(e.id)} onToggle={() => toggleSkip(e.id)} memberNames={memberNames} run={run} />
            ))}
          </ul>
          <EntryForm
            listId={list.id}
            memberNames={memberNames}
            onAdd={(v) => run("추가하지 못했습니다", supabase.from("chore_entries").insert({ list_id: list.id, ...v }))}
          />

          {order && (
            <>
              <h4 className={s.infoHead}>주문 정리 ({going.length}명)</h4>
              <pre className={s.choreOrder}>{order}</pre>
              {tooLong && <p className="error-text">2000자를 넘어 채널에 올릴 수 없습니다. 복사해서 쓰세요</p>}
              <span className={s.todoActions}>
                <button className={s.action} onClick={() => void copy()}>
                  복사
                </button>
                <button className={s.action} onClick={() => void post()} disabled={tooLong || posting}>
                  채널에 올리기
                </button>
                {posted && <span className="muted">{posted}</span>}
              </span>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function EntryRow({
  entry,
  going,
  onToggle,
  memberNames,
  run,
}: {
  entry: ChoreEntry;
  going: boolean;
  onToggle: () => void;
  memberNames: string[];
  run: Run;
}) {
  const supabase = getSupabase();
  const [editing, setEditing] = useState(false);

  if (editing)
    return (
      <li>
        <EntryForm
          listId={entry.list_id}
          initial={entry}
          memberNames={memberNames}
          onCancel={() => setEditing(false)}
          onAdd={async (v) => {
            const ok = await run("고치지 못했습니다", supabase.from("chore_entries").update(v).eq("id", entry.id));
            if (ok) setEditing(false);
            return ok;
          }}
        />
      </li>
    );

  return (
    <li>
      <label className={s.todoCheck}>
        <input type="checkbox" checked={going} onChange={onToggle} aria-label={`${entry.person_name} 오늘 포함`} />
        <span>
          <SafeText text={entry.person_name} /> <span className={s.choreDetail}>— <SafeText text={entry.detail} /></span>
        </span>
      </label>
      <span className={s.memberActions}>
        <button className="link" onClick={() => setEditing(true)}>
          고치기
        </button>
        <button className="link" onClick={() => void run("지우지 못했습니다", supabase.from("chore_entries").delete().eq("id", entry.id))}>
          지우기
        </button>
      </span>
    </li>
  );
}

type ListValues = { title: string; place: string; memo: string };

function ListForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ListValues;
  submitLabel: string;
  onSubmit: (v: ListValues) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [place, setPlace] = useState(initial?.place ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onSubmit({ title: title.trim(), place: place.trim(), memo: memo.trim() });
    setBusy(false);
  }

  return (
    <form className={s.choreForm} onSubmit={submit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="목록 이름 (예: 커피)" aria-label="목록 이름" required />
      <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={100} placeholder="장소 (예: 1층 스타벅스)" aria-label="장소" />
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="메모 — 가는 길, 결제 방법, 전화번호, 주의할 점 (예: 법인카드, 11시 반 전에 주문)"
        aria-label="메모"
      />
      <span className={s.todoActions}>
        <button className={s.action} type="submit" disabled={busy || !title.trim()}>
          {submitLabel}
        </button>
        <button className="link" type="button" onClick={onCancel}>
          취소
        </button>
      </span>
    </form>
  );
}

function EntryForm({
  listId,
  initial,
  memberNames,
  onAdd,
  onCancel,
}: {
  listId: string;
  initial?: Pick<ChoreEntry, "person_name" | "detail">;
  memberNames: string[];
  onAdd: (v: { person_name: string; detail: string }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [person, setPerson] = useState(initial?.person_name ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [busy, setBusy] = useState(false);
  const listIdFor = `chore-people-${listId}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!person.trim() || !detail.trim()) return;
    setBusy(true);
    const ok = await onAdd({ person_name: person.trim(), detail: detail.trim() });
    setBusy(false);
    if (ok && !initial) {
      setPerson("");
      setDetail("");
    }
  }

  return (
    <form className={s.choreEntryForm} onSubmit={submit}>
      {/* 채널 멤버 이름을 추천하지만, 호칭("이부장님")이나 계정 없는 사람도 적을 수 있다 */}
      <input
        value={person}
        onChange={(e) => setPerson(e.target.value)}
        list={listIdFor}
        maxLength={30}
        placeholder="누구 (예: 이부장님)"
        aria-label="사람"
      />
      <datalist id={listIdFor}>
        {memberNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <input value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={200} placeholder="무엇 (예: 아아 얼음 많이)" aria-label="내용" />
      <span className={s.todoActions}>
        <button className={s.action} type="submit" disabled={busy || !person.trim() || !detail.trim()}>
          {initial ? "저장" : "추가"}
        </button>
        {onCancel && (
          <button className="link" type="button" onClick={onCancel}>
            취소
          </button>
        )}
      </span>
    </form>
  );
}
