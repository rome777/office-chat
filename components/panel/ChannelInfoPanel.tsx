"use client";

// ③ 채널 정보 패널 (2026-09-30 개편): 채널 이름·설명 | 멤버 | 고정된 메시지 | 채널 설정(이름·설명 수정, 알림, 초대, 나가기) | 관리 기록.
// 멤버 추가와 초대 권한 주기는 초대 권한이 있는 사람(만든 사람·권한을 받은 멤버·관리자)에게,
// 내보내기·초대 권한 빼기·관리 기록은 관리자에게만 보인다. 이름·설명 수정은 만든 사람·관리자, 부서 채널 이름은 못 바꾼다.
// 실제 권한은 DB 정책(RLS)이 검사한다 (TECH_SPEC 5절, npm run check:db·check:chat 으로 확인).
// 남을 넣고 빼거나 초대 권한을 주고 빼면 트리거가 admin_logs 에 남긴다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useChannelMembers } from "@/components/chat/useChannelMembers";
import { usePins, togglePin } from "@/components/chat/pins";
import { useSelf } from "@/components/chat/useSelf";
import { setMuted, useMutedChannels } from "@/components/notifications/mutes";
import { useMentionLabels } from "@/components/people/directory";
import PeoplePicker from "@/components/people/PeoplePicker";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { DESCRIPTION_MAX, updateChannel, useChannelDetails } from "@/components/shell/channelDetails";
import { BellIcon, EditIcon, HashIcon, LogoutIcon, PinIcon, UsersIcon } from "@/components/shell/icons";
import { openProfileCard } from "@/components/shell/cardStore";
import { GENERAL_ID, NAME_MAX } from "@/components/sidebar/channelSource";
import { showMentions } from "@/lib/mentions";
import type { Person } from "@/lib/types/people";
import { getSupabase } from "@/lib/supabase";
import s from "./channelInfo.module.css";

const TYPE_LABEL: Record<string, string> = { public: "공개 채널", private: "비공개 채널", dm: "DM" };
const LOG_LABEL: Record<string, string> = {
  add_member: "추가함",
  remove_member: "내보냄",
  grant_invite: "초대 권한을 줌",
  revoke_invite: "초대 권한을 뺌",
};
const AVATARS_SHOWN = 8;

type Log = { id: number; action: string; actor_id: string | null; target: { channel_id?: string; user_id?: string }; created_at: string };
type Message = { kind: "ok" | "error"; text: string } | null;

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export default function ChannelInfoPanel() {
  const { channel, setChannel } = useWorkspace();
  const router = useRouter();
  const self = useSelf();
  const members = useChannelMembers(channel.id);
  const details = useChannelDetails(channel.id);
  const pins = usePins(channel.id);
  const muted = useMutedChannels().has(channel.id);
  const labels = useMentionLabels();
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<Log[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [allMembers, setAllMembers] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState(false);

  const type = details?.type ?? channel.type ?? null;
  const isAdmin = !!self && roles[self.id] === "admin";
  const channelKind = type !== null && type !== "dm"; // 공개·비공개 채널 (DM 은 멤버를 바꾸지 않는다)
  const manageable = isAdmin && channelKind;
  const canInvite = channelKind && (isAdmin || !!members.find((m) => m.id === self?.id)?.can_invite);
  const canEdit = channelKind && !!self && (isAdmin || details?.created_by === self.id);
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const nameOf = useMemo(() => new Map(members.map((m) => [m.id, m.display_name])), [members]);

  // 멤버·나의 역할 (관리자 표시와 버튼에 쓴다)
  useEffect(() => {
    let alive = true;
    const ids = [...new Set([...memberIds, ...(self ? [self.id] : [])])];
    if (ids.length) {
      void getSupabase()
        .from("profiles")
        .select("id, role")
        .in("id", ids)
        .then(({ data }) => alive && setRoles(Object.fromEntries((data ?? []).map((p) => [p.id, p.role]))));
    }
    return () => {
      alive = false;
    };
  }, [memberIds, self]);

  // 채널을 바꾸면 펼친 것·입력하던 것을 닫는다
  useEffect(() => {
    setEditing(false);
    setInviting(false);
    setAllMembers(false);
    setMessage(null);
  }, [channel.id]);

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

  // 멤버가 들고 나거나 초대 권한이 바뀌면 (내가 했든 남이 했든) 기록을 다시 불러온다
  const rightsKey = members.map((m) => `${m.id}:${m.can_invite ? 1 : 0}`).join(",");
  useEffect(() => {
    void loadLogs();
  }, [loadLogs, rightsKey]);

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

  // 초대 권한은 권한 있는 사람이 주고, 빼는 것은 관리자만. 권한이 없으면 RLS 가 0건을 고친다
  async function setInviteRight(userId: string, name: string, value: boolean) {
    setBusy(true);
    const { data, error } = await getSupabase()
      .from("memberships")
      .update({ can_invite: value })
      .eq("channel_id", channel.id)
      .eq("user_id", userId)
      .select("user_id");
    setBusy(false);
    if (error || !data?.length) {
      return setMessage({ kind: "error", text: value ? "초대 권한을 주지 못했습니다" : "초대 권한을 빼지 못했습니다. 관리자만 할 수 있습니다" });
    }
    setMessage({ kind: "ok", text: value ? `${name} 님에게 초대 권한을 줬습니다` : `${name} 님의 초대 권한을 뺐습니다` });
  }

  async function leave() {
    if (!self || !window.confirm(`#${channel.name} 에서 나갈까요?`)) return;
    const { error } = await getSupabase().from("memberships").delete().eq("channel_id", channel.id).eq("user_id", self.id);
    if (error) setMessage({ kind: "error", text: `나가지 못했습니다: ${error.message}` });
    // 보던 채널에서 빠지면 메시지 목록 칸이 보이는 첫 채널로 보낸다
  }

  async function toggleMute() {
    try {
      await setMuted(channel.id, !muted);
      setMessage({ kind: "ok", text: muted ? "이 채널의 알림을 다시 켰습니다" : "이 채널의 알림을 껐습니다 (안 읽은 수는 그대로 보입니다)" });
    } catch (e) {
      setMessage({ kind: "error", text: `알림 설정을 바꾸지 못했습니다: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function unpin(messageId: number) {
    try {
      await togglePin(channel.id, messageId);
    } catch (e) {
      setMessage({ kind: "error", text: `고정을 풀지 못했습니다: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const title = type === "dm" ? `@${channel.name}` : channel.name;
  const shownAvatars = members.slice(0, AVATARS_SHOWN);

  return (
    <div className={s.info}>
      <section className={s.hero}>
        <span className={s.tile} aria-hidden="true">
          <HashIcon size={30} />
        </span>
        <div className={s.heroText}>
          <h3 className={s.name}>
            {title}
            {type && <span className={s.kind}>{TYPE_LABEL[type] ?? type}</span>}
          </h3>
          <p className={s.desc}>{details?.description || (canEdit ? "설명을 적어 두면 채팅 머리에 보입니다" : "설명이 없습니다")}</p>
        </div>
        {canEdit && !editing && (
          <button type="button" className={s.iconButton} onClick={() => setEditing(true)} aria-label="채널 이름·설명 수정">
            <EditIcon size={18} />
          </button>
        )}
      </section>

      {editing && details && (
        <EditForm
          key={channel.id}
          name={details.name}
          description={details.description}
          nameLocked={details.org}
          onCancel={() => setEditing(false)}
          onSave={async (patch) => {
            await updateChannel(channel.id, patch);
            if (patch.name) setChannel({ ...channel, name: patch.name.trim() });
            setEditing(false);
            setMessage({ kind: "ok", text: "채널 정보를 고쳤습니다" });
          }}
        />
      )}

      {message && <p className={message.kind === "error" ? `error-text ${s.message}` : `muted ${s.message}`}>{message.text}</p>}

      <section className={s.block}>
        <div className={s.blockHead}>
          <h4>멤버 ({members.length})</h4>
          <button type="button" className="link" onClick={() => setAllMembers((v) => !v)}>
            {allMembers ? "접기" : "모두 보기 ›"}
          </button>
        </div>
        {!allMembers ? (
          <div className={s.avatars}>
            {shownAvatars.map((m) => (
              <button key={m.id} type="button" className={s.avatarButton} onClick={() => openProfileCard(m.id)} title={m.display_name} aria-label={`${m.display_name} 프로필`}>
                <PersonAvatar userId={m.id} name={m.display_name} size={34} />
              </button>
            ))}
            {members.length > AVATARS_SHOWN && (
              <button type="button" className={s.more} onClick={() => setAllMembers(true)} aria-label="멤버 모두 보기">
                +{members.length - AVATARS_SHOWN}
              </button>
            )}
          </div>
        ) : (
          <ul className={s.memberList}>
            {members.map((m) => (
              <li key={m.id}>
                <button type="button" className={s.memberWho} onClick={() => openProfileCard(m.id)}>
                  <PersonAvatar userId={m.id} name={m.display_name} size={28} />
                  <span>
                    <strong>{m.display_name}</strong>
                    {m.department && <span className="muted"> · {m.department}</span>}
                    {roles[m.id] === "admin" && <span className={s.adminBadge}>관리자</span>}
                    {channelKind && m.can_invite && <span className={s.inviteBadge}>초대 권한</span>}
                    {self?.id === m.id && <span className="muted"> (나)</span>}
                  </span>
                </button>
                {self?.id !== m.id && (canInvite || manageable) && (
                  <span className={s.memberActions}>
                    {canInvite && !m.can_invite && (
                      <button className="link" disabled={busy} onClick={() => void setInviteRight(m.id, m.display_name, true)}>
                        초대 권한 주기
                      </button>
                    )}
                    {manageable && m.can_invite && (
                      <button className="link" disabled={busy} onClick={() => void setInviteRight(m.id, m.display_name, false)}>
                        초대 권한 빼기
                      </button>
                    )}
                    {manageable && (
                      <button className="link" disabled={busy} onClick={() => void remove(m.id, m.display_name)}>
                        내보내기
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.block}>
        <div className={s.blockHead}>
          <h4>
            <PinIcon size={17} /> 고정된 메시지 <span className={s.count}>{pins.length}</span>
          </h4>
        </div>
        {pins.length === 0 ? (
          <p className={s.empty}>고정된 메시지가 없습니다. 메시지에 마우스를 올려 📌 를 누르면 고정됩니다.</p>
        ) : (
          <ul className={s.pinList}>
            {pins.map((p) => (
              <li key={p.message_id}>
                <button type="button" className={s.pinBody} onClick={() => router.push(`/chat?m=${p.message_id}`)}>
                  <span className={s.pinMeta}>
                    <strong>{(p.user_id && nameOf.get(p.user_id)) || "알 수 없음"}</strong> · {formatWhen(p.created_at)}
                  </span>
                  <span className={s.pinText}>{showMentions(p.body, labels) || "(첨부)"}</span>
                </button>
                <button type="button" className="link" onClick={() => void unpin(p.message_id)}>
                  고정 해제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.block}>
        <div className={s.blockHead}>
          <h4>채널 설정</h4>
        </div>
        <ul className={s.settings}>
          {canEdit && (
            <li>
              <button type="button" className={s.setting} onClick={() => setEditing(true)}>
                <EditIcon size={18} /> 채널 이름·설명 수정
              </button>
            </li>
          )}
          <li>
            <button type="button" className={s.setting} onClick={() => void toggleMute()} aria-pressed={!muted}>
              <BellIcon size={18} /> 알림 설정
              <span className={`${s.switch} ${muted ? "" : s.switchOn}`}>{muted ? "꺼짐" : "켜짐"}</span>
            </button>
          </li>
          {canInvite && (
            <li>
              <button type="button" className={s.setting} aria-expanded={inviting} onClick={() => setInviting((v) => !v)}>
                <UsersIcon size={18} /> 채널 초대
                <span className={s.chevron}>{inviting ? "⌃" : "›"}</span>
              </button>
              {inviting && (
                <div className={s.invite}>
                  <PeoplePicker value={adding} onChange={setAdding} exclude={memberIds} />
                  <button className={s.primary} disabled={busy || adding.length === 0} onClick={() => void addMembers()}>
                    추가하기
                  </button>
                </div>
              )}
            </li>
          )}
          {type !== "dm" && channel.id !== GENERAL_ID && !details?.org && (
            <li>
              <button type="button" className={`${s.setting} ${s.danger}`} onClick={() => void leave()}>
                <LogoutIcon size={18} /> 채널 나가기
              </button>
            </li>
          )}
        </ul>
        {details?.org && <p className={s.empty}>부서 채널은 소속이 바뀔 때 자동으로 들고 납니다.</p>}
      </section>

      {isAdmin && (
        <section className={s.block}>
          <div className={s.blockHead}>
            <h4>관리 기록</h4>
          </div>
          {logs.length === 0 ? (
            <p className={s.empty}>이 채널의 관리 기록이 없습니다</p>
          ) : (
            <ul className={s.logList}>
              {logs.map((l) => (
                <li key={l.id}>
                  <time className="muted">{formatWhen(l.created_at)}</time>{" "}
                  {names[l.actor_id ?? ""] ?? "알 수 없음"} 님이 {names[l.target.user_id ?? ""] ?? "알 수 없음"} 님을{" "}
                  {LOG_LABEL[l.action] ?? l.action}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function EditForm({
  name,
  description,
  nameLocked,
  onCancel,
  onSave,
}: {
  name: string;
  description: string;
  nameLocked: boolean;
  onCancel: () => void;
  onSave: (patch: { name?: string; description?: string }) => Promise<void>;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftDesc, setDraftDesc] = useState(description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: { name?: string; description?: string } = {};
    if (!nameLocked && draftName.trim() !== name) patch.name = draftName;
    if (draftDesc.trim() !== description) patch.description = draftDesc;
    if (!patch.name && patch.description === undefined) return onCancel();
    setBusy(true);
    setError(null);
    try {
      await onSave(patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form className={s.edit} onSubmit={(e) => void save(e)}>
      <label>
        채널 이름
        <input
          value={draftName}
          maxLength={NAME_MAX}
          disabled={nameLocked}
          onChange={(e) => setDraftName(e.target.value)}
          aria-describedby={nameLocked ? "channel-name-locked" : undefined}
        />
      </label>
      {nameLocked && (
        <p id="channel-name-locked" className={s.empty}>
          부서 채널의 이름은 조직 이름을 따라갑니다
        </p>
      )}
      <label>
        설명
        <textarea value={draftDesc} maxLength={DESCRIPTION_MAX} rows={3} onChange={(e) => setDraftDesc(e.target.value)} placeholder="자유롭게 소통하는 채널입니다" />
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className={s.editActions}>
        <button type="button" className={s.secondary} onClick={onCancel}>
          취소
        </button>
        <button type="submit" className={s.primary} disabled={busy}>
          {busy ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
