"use client";

// ③ 채널 정보 패널 (2026-09-30 개편): 채널 이름·설명 | 멤버 | 고정된 메시지 | 채널 설정(이름·설명 수정, 알림, 초대, 나가기) | 관리 기록.
// 일반 채널(부서 채널이 아닌 공개·비공개)은 리더·부리더를 둔다 (2026-09-30 WU-39, 20260930210000_channel_leaders.sql):
//   이름·설명 수정은 리더, 초대는 공개면 멤버 누구나·비공개면 리더·부리더, 내보내기는 리더(부리더·멤버)·부리더(멤버만),
//   부리더 지정·해제와 리더 넘기기는 리더. 멤버 옆 ⋯ 메뉴에 내가 할 수 있는 것만 보인다.
// 부서 채널(#일반 포함)은 관리자만 고치고 초대한다. 회사 관리자는 어디서나 다 한다. 관리 기록은 관리자에게만 보인다.
// 실제 권한은 DB 정책(RLS)·함수가 검사한다 (TECH_SPEC 5절, npm run check:db·check:chat 으로 확인).
// 남을 넣고 빼거나 역할이 바뀌면 admin_logs 에 남는다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useChannelMembers, type ChannelRole, type Member } from "@/components/chat/useChannelMembers";
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
const AVATARS_SHOWN = 8;
const ROLE_LABEL: Record<ChannelRole, string> = { leader: "리더", sub: "부리더", member: "" };
const ROLE_ORDER: Record<ChannelRole, number> = { leader: 0, sub: 1, member: 2 };
/** 부리더 한도: 멤버 10명당 1명, 최대 5명 (DB 의 sub_leader_limit() 와 같다) */
const subLimit = (memberCount: number) => Math.min(5, Math.max(1, Math.ceil(memberCount / 10)));

type Log = { id: number; action: string; actor_id: string | null; target: { channel_id?: string; user_id?: string; from?: string }; created_at: string };

function logText(l: Log, names: Record<string, string>) {
  const who = (id?: string | null) => (id && names[id]) || "알 수 없음";
  const actor = who(l.actor_id);
  const target = who(l.target.user_id);
  switch (l.action) {
    case "add_member":
      return `${actor} 님이 ${target} 님을 추가함`;
    case "remove_member":
      return `${actor} 님이 ${target} 님을 내보냄`;
    case "grant_sub":
      return `${actor} 님이 ${target} 님을 부리더로 지정함`;
    case "revoke_sub":
      return `${actor} 님이 ${target} 님을 부리더에서 해제함`;
    case "transfer_leader":
      return `${actor} 님이 ${target} 님에게 리더를 넘김`;
    case "auto_leader":
      return l.target.from ? `리더(${who(l.target.from)})가 빠져 ${target} 님이 리더가 됨` : `비어 있던 채널에 들어와 ${target} 님이 리더가 됨`;
    case "grant_invite":
      return `${actor} 님이 ${target} 님에게 초대 권한을 줌`;
    case "revoke_invite":
      return `${actor} 님이 ${target} 님의 초대 권한을 뺌`;
    default:
      return `${actor} 님 · ${l.action} · ${target}`;
  }
}

function CrownIcon({ filled, size = 13 }: { filled: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5Z" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}
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
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [handingTo, setHandingTo] = useState<Member | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  const type = details?.type ?? channel.type ?? null;
  const isAdmin = !!self && roles[self.id] === "admin";
  const channelKind = type !== null && type !== "dm"; // 공개·비공개 채널 (DM 은 멤버를 바꾸지 않는다)
  // DB 의 has_invite_right()·채널 수정·내보내기 정책과 같은 조건 (20260930210000_channel_leaders.sql)
  const team = channelKind && !!details && !details.org; // 리더·부리더를 두는 일반 채널
  const myRole: ChannelRole | null = members.find((m) => m.id === self?.id)?.role ?? null;
  const canEdit = channelKind && (isAdmin || (team && myRole === "leader"));
  const canInvite = channelKind && (isAdmin || (team && (type === "public" ? myRole !== null : myRole === "leader" || myRole === "sub")));
  const leads = isAdmin || myRole === "leader"; // 부리더 지정·해제, 리더 넘기기
  const subCount = members.filter((m) => m.role === "sub").length;
  const limit = subLimit(members.length);
  const sorted = useMemo(
    () =>
      [...members].sort(
        (a, b) =>
          ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
          (a.role_at ?? "").localeCompare(b.role_at ?? "") ||
          a.display_name.localeCompare(b.display_name, "ko"),
      ),
    [members],
  );
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
    setMenuFor(null);
    setHandingTo(null);
  }, [channel.id]);

  // 리더 넘기기 확인 창: Esc 로 닫고, Tab 은 창 안에서만 돈다
  useEffect(() => {
    if (!handingTo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setHandingTo(null);
      if (e.key !== "Tab" || !confirmRef.current) return;
      const buttons = [...confirmRef.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handingTo]);

  // ⋯ 메뉴: 바깥을 누르거나 Esc 면 닫는다
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-member-menu]")) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

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
    const ids = [...new Set(list.flatMap((l) => [l.actor_id, l.target.user_id, l.target.from]).filter((v): v is string => !!v))];
    if (ids.length) {
      const { data: people } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.display_name])));
    }
  }, [channel.id, isAdmin]);

  // 멤버가 들고 나거나 역할이 바뀌면 (내가 했든 남이 했든) 기록을 다시 불러온다
  const membersKey = members.map((m) => `${m.id}:${m.role}`).join(",");
  useEffect(() => {
    void loadLogs();
  }, [loadLogs, membersKey]);

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
    if (error || !data?.length) return setMessage({ kind: "error", text: "내보내지 못했습니다. 권한이 없습니다" });
    setMessage({ kind: "ok", text: `${name} 님을 내보냈습니다` });
  }

  async function setSub(m: Member, on: boolean) {
    setMenuFor(null);
    setBusy(true);
    const { error } = await getSupabase().rpc("set_sub_leader", { p_channel: channel.id, p_user: m.id, p_on: on });
    setBusy(false);
    if (error) return setMessage({ kind: "error", text: error.message });
    setMessage({ kind: "ok", text: on ? `${m.display_name} 님을 부리더로 지정했습니다` : `${m.display_name} 님을 부리더에서 해제했습니다` });
  }

  async function handOver(m: Member) {
    setBusy(true);
    const { error } = await getSupabase().rpc("transfer_leader", { p_channel: channel.id, p_user: m.id });
    setBusy(false);
    setHandingTo(null);
    if (error) return setMessage({ kind: "error", text: error.message });
    setMessage({ kind: "ok", text: `${m.display_name} 님에게 리더를 넘겼습니다` });
  }

  // 이 멤버에게 내가 할 수 있는 것 (DB 정책과 같은 조건)
  function actionsFor(m: Member) {
    type Action = { label: string; onClick: () => void; crown?: "fill" | "line"; danger?: boolean; disabled?: boolean; hint?: string };
    const items: Action[] = [];
    if (!channelKind || self?.id === m.id) return items;
    if (team && leads && m.role !== "leader") {
      if (m.role === "sub") {
        items.push({ label: "부리더 해제", crown: "line", onClick: () => void setSub(m, false) });
      } else {
        const full = subCount >= limit;
        items.push({
          label: "부리더로 지정",
          crown: "line",
          disabled: full,
          hint: full ? `멤버 ${members.length}명 기준 최대 ${limit}명 — 찼음` : undefined,
          onClick: () => void setSub(m, true),
        });
      }
      items.push({
        label: "리더 넘기기",
        crown: "fill",
        onClick: () => {
          setMenuFor(null);
          setHandingTo(m);
        },
      });
    }
    const canKick = isAdmin || (team && ((myRole === "leader" && m.role !== "leader") || (myRole === "sub" && m.role === "member")));
    if (canKick) {
      items.push({
        label: "내보내기",
        danger: true,
        onClick: () => {
          setMenuFor(null);
          void remove(m.id, m.display_name);
        },
      });
    }
    return items;
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
    const others = members.filter((m) => m.id !== self?.id);
    const note =
      team && myRole === "leader"
        ? others.length > 0
          ? "\n\n나가면 리더가 먼저 된 부리더(없으면 가장 먼저 들어온 멤버)에게 넘어갑니다."
          : "\n\n마지막 멤버라 채널이 비어 남습니다. 다음에 들어오는 사람이 리더가 됩니다."
        : "";
    if (!self || !window.confirm(`#${channel.name} 에서 나갈까요?${note}`)) return;
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
              <button key={m.id} type="button" className={s.avatarButton} onClick={() => openProfileCard(m.id)} title={[m.display_name, m.department, m.title].filter(Boolean).join(" · ")} aria-label={`${m.display_name} 프로필`}>
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
            {sorted.map((m) => {
              const actions = actionsFor(m);
              return (
                <li key={m.id}>
                  <button type="button" className={s.memberWho} onClick={() => openProfileCard(m.id)}>
                    <PersonAvatar userId={m.id} name={m.display_name} size={28} />
                    <span>
                      <strong>{m.display_name}</strong>
                      {team && m.role !== "member" && (
                        <span className={s.roleBadge} title={m.role === "leader" ? "채널 리더" : "채널 부리더"}>
                          <CrownIcon filled={m.role === "leader"} /> {ROLE_LABEL[m.role]}
                        </span>
                      )}
                      {roles[m.id] === "admin" && <span className={s.adminBadge}>관리자</span>}
                      {self?.id === m.id && <span className="muted"> (나)</span>}
                      {(m.department || m.title) && <span className={s.memberSub}>{[m.department, m.title].filter(Boolean).join(" · ")}</span>}
                    </span>
                  </button>
                  {actions.length > 0 && (
                    <span className={s.memberMenuWrap} data-member-menu>
                      <button
                        type="button"
                        className={`${s.dots} ${menuFor === m.id ? s.dotsOn : ""}`}
                        aria-label={`${m.display_name} 님 관리`}
                        aria-expanded={menuFor === m.id}
                        disabled={busy}
                        onClick={() => setMenuFor((v) => (v === m.id ? null : m.id))}
                      >
                        ⋯
                      </button>
                      {menuFor === m.id && (
                        <span className={s.memberMenu} role="menu">
                          {actions.map((a) => (
                            <button
                              key={a.label}
                              type="button"
                              role="menuitem"
                              className={`${s.memberMenuItem} ${a.danger ? s.danger : ""}`}
                              disabled={a.disabled}
                              onClick={a.onClick}
                            >
                              <span className={s.memberMenuLine}>
                                {a.crown && <CrownIcon filled={a.crown === "fill"} size={15} />}
                                {a.label}
                              </span>
                              {a.hint && <span className={s.memberMenuHint}>{a.hint}</span>}
                            </button>
                          ))}
                        </span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
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
          {team && myRole === "leader" && (
            <li className={s.leaderInfo}>
              <CrownIcon filled={false} size={16} /> 부리더 {subCount} / {limit}명 (멤버 10명당 1명, 최대 5명)
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
        {team && !canEdit && <p className={s.empty}>이름·설명 수정은 리더만 할 수 있습니다</p>}
        {team && type === "private" && !canInvite && <p className={s.empty}>비공개 채널 초대는 리더·부리더만 할 수 있습니다</p>}
      </section>

      {handingTo && (
        <div className={s.confirmBackdrop} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setHandingTo(null)}>
          <div className={s.confirm} ref={confirmRef} role="dialog" aria-modal="true" aria-labelledby="hand-over-title">
            <h4 id="hand-over-title">
              <CrownIcon filled size={20} /> 리더를 넘길까요?
            </h4>
            <p>
              {handingTo.display_name} 님이 {channel.name} 의 리더가 됩니다.
              <br />
              {myRole === "leader" ? "나는 부리더가 됩니다." : "지금 리더는 부리더가 됩니다."}
            </p>
            <p className={s.empty}>넘긴 뒤에는 새 리더만 다시 넘길 수 있습니다.</p>
            <div className={s.editActions}>
              <button type="button" className={s.secondary} onClick={() => setHandingTo(null)} autoFocus>
                취소
              </button>
              <button type="button" className={s.primary} disabled={busy} onClick={() => void handOver(handingTo)}>
                넘기기
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <time className="muted">{formatWhen(l.created_at)}</time> {logText(l, names)}
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
