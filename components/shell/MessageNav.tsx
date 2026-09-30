"use client";

// 채팅 화면의 메시지 목록 칸: 검색 · 즐겨찾기 · 채널 · 다이렉트 메시지 (2026-09-30 개편).
// 목록 데이터·미읽음·대화상자는 ② 의 것(sidebar/)을 그대로 쓴다. #일반 은 목록에서 숨긴다.
// "보던 채널에서 빠지면 다른 채널로", "DM 상대 이름 맞추기"도 여기서 한다 (예전 왼쪽 칸이 하던 일).

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChannelSummary, DmSummary } from "@/lib/types/channel";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { useMutedChannels } from "@/components/notifications/mutes";
import BrowseChannelsDialog from "@/components/sidebar/BrowseChannelsDialog";
import CreateChannelDialog from "@/components/sidebar/CreateChannelDialog";
import NewDmDialog from "@/components/sidebar/NewDmDialog";
import { LockIcon } from "@/components/sidebar/ActionIcons";
import { GENERAL_ID } from "@/components/sidebar/channelSource";
import { useMyChannels, useMyDms, useUnread } from "@/components/sidebar/useChannels";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useFavorites } from "./favorites";
import { BellOffIcon, ChevronIcon, ComposeIcon, HashIcon, PlusIcon, SearchIcon, StarIcon } from "./icons";
import s from "./chat.module.css";

type Dialog = "create" | "browse" | "dm" | null;
const norm = (v: string) => v.normalize("NFC").toLowerCase();

export default function MessageNav() {
  const { channel, setChannel } = useWorkspace();
  const { channels, error: channelError } = useMyChannels();
  const { dms, error: dmError } = useMyDms();
  const favorites = useFavorites();
  const muted = useMutedChannels();
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const current = useRef(channel);
  current.current = channel;

  const visible = useMemo(() => (channels ?? []).filter((c) => c.id !== GENERAL_ID), [channels]);

  // ── 보던 대화 지키기 ──
  // 종류(type)를 모르는 대화 = 기본값(#일반)이거나 다른 영역이 id·이름만 넘긴 것 (메시지로 이동, 대시보드).
  // 기본값이면(주소에 ?c·?m 이 없을 때) 즐겨찾기 → 첫 채널 → 첫 DM 을 열고, 아니면 목록에서 종류·이름을 채운다.
  // 한 effect 에서 한다 — 둘로 나누면 같은 그림에서 둘 다 setChannel 해서 뒤의 것(#일반 채우기)이 이긴다 (2026-09-30)
  useEffect(() => {
    if (channel.type || !channels || !dms) return;
    const q = new URLSearchParams(window.location.search);
    if (channel.id === GENERAL_ID && !q.has("c") && !q.has("m")) {
      const pick = visible.find((c) => favorites.has(c.id)) ?? visible[0];
      if (pick) return setChannel({ id: pick.id, name: pick.name, type: pick.type });
      const dm = dms[0];
      if (dm) return setChannel({ id: dm.id, name: dm.other.display_name, type: "dm" });
    }
    const c = channels.find((x) => x.id === channel.id);
    if (c) return setChannel({ id: c.id, name: c.name, type: c.type });
    const d = dms.find((x) => x.id === channel.id);
    if (d) setChannel({ id: d.id, name: d.other.display_name, type: "dm" });
  }, [channel, channels, dms, visible, favorites, setChannel]);

  // 보던 채널에서 빠지면(관리자가 제거, 나가기) 보이는 첫 채널로. 목록을 새로 받았을 때만 본다
  useEffect(() => {
    if (!channels) return;
    const cur = current.current;
    if (!cur.type || cur.type === "dm" || channels.some((c) => c.id === cur.id)) return;
    const next = visible[0];
    setChannel(next ? { id: next.id, name: next.name, type: next.type } : { id: GENERAL_ID, name: "일반", type: "public" });
  }, [channels, visible, setChannel]);

  // 보던 DM 이 사라지거나 상대 이름이 바뀌면 맞춘다
  useEffect(() => {
    if (!dms) return;
    const cur = current.current;
    if (cur.type !== "dm") return;
    const found = dms.find((d) => d.id === cur.id);
    if (!found) {
      const next = visible[0];
      if (next) setChannel({ id: next.id, name: next.name, type: next.type });
    } else if (found.other.display_name !== cur.name) {
      setChannel({ ...cur, name: found.other.display_name });
    }
  }, [dms, visible, setChannel]);

  // ── 목록 ──
  const q = norm(query.trim());
  const match = (name: string, extra?: string | null) => !q || norm(name).includes(q) || norm(extra ?? "").includes(q);
  const favChannels = visible.filter((c) => favorites.has(c.id) && match(c.name));
  const favDms = (dms ?? []).filter((d) => favorites.has(d.id) && match(d.other.display_name, d.other.department));
  const restChannels = visible.filter((c) => !favorites.has(c.id) && match(c.name));
  const restDms = (dms ?? []).filter((d) => !favorites.has(d.id) && match(d.other.display_name, d.other.department));

  const openChannel = (c: ChannelSummary) => {
    setChannel({ id: c.id, name: c.name, type: c.type });
    setDialog(null);
  };
  const openDm = (d: DmSummary) => setChannel({ id: d.id, name: d.other.display_name, type: "dm" });
  const toggle = (key: string) => setClosed((v) => ({ ...v, [key]: !v[key] }));

  const channelRow = (c: ChannelSummary) => (
    <Row
      key={c.id}
      id={c.id}
      active={c.id === channel.id}
      muted={muted.has(c.id)}
      label={c.type === "private" ? `${c.name} (비공개)` : c.name}
      onClick={() => openChannel(c)}
      icon={<HashIcon size={16} />}
    >
      <span className={s.rowName}>{c.name}</span>
      {c.type === "private" && (
        <span className={s.rowLock}>
          <LockIcon />
        </span>
      )}
    </Row>
  );

  const dmRow = (d: DmSummary) => (
    <Row
      key={d.id}
      id={d.id}
      active={d.id === channel.id}
      muted={muted.has(d.id)}
      label={`${d.other.display_name} 님과 DM`}
      onClick={() => openDm(d)}
      icon={<PersonAvatar userId={d.other.id} name={d.other.display_name} size={24} />}
    >
      <span className={s.rowName}>{d.other.display_name}</span>
      {d.other.department && <span className={s.rowMeta}>{d.other.department}</span>}
    </Row>
  );

  const nothing = q && favChannels.length + favDms.length + restChannels.length + restDms.length === 0;

  return (
    <nav className={s.msgNav} aria-label="대화 목록">
      <div className={s.msgNavHead}>
        <h2>메시지</h2>
        <span className={s.msgNavTools}>
          <button type="button" className={s.iconButton} onClick={() => setDialog("dm")} aria-label="새 메시지" title="새 메시지">
            <ComposeIcon size={18} />
          </button>
          <button
            type="button"
            className={s.iconButton}
            onClick={() => filterRef.current?.focus()}
            aria-label="목록에서 찾기"
            title="목록에서 찾기"
          >
            <SearchIcon size={16} />
          </button>
        </span>
      </div>
      <label className={s.filter}>
        <SearchIcon size={14} />
        <input
          ref={filterRef}
          value={query}
          placeholder="채널 또는 대화 검색"
          aria-label="채널 또는 대화 검색"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        />
      </label>

      <div className={s.msgNavBody}>
        {(channelError || dmError) && <p className="error-text">목록을 못 불러왔습니다: {channelError ?? dmError}</p>}
        {nothing && <p className={s.navEmpty}>“{query.trim()}” 와 맞는 대화가 없습니다</p>}

        {(favChannels.length > 0 || favDms.length > 0) && (
          <Section title="즐겨찾기" icon={<StarIcon size={15} />} open={!closed.fav} onToggle={() => toggle("fav")}>
            {favChannels.map(channelRow)}
            {favDms.map(dmRow)}
          </Section>
        )}

        <Section title="채널" open={!closed.ch} onToggle={() => toggle("ch")}>
          {channels === null && !channelError && <li className={s.navEmpty}>불러오는 중…</li>}
          {restChannels.map(channelRow)}
          {!q && (
            <>
              <li>
                <button type="button" className={s.action} onClick={() => setDialog("create")}>
                  <PlusIcon size={16} /> 채널 만들기
                </button>
              </li>
              <li>
                <button type="button" className={s.action} onClick={() => setDialog("browse")}>
                  <SearchIcon size={16} /> 채널 찾기
                </button>
              </li>
            </>
          )}
        </Section>

        <Section title="다이렉트 메시지" open={!closed.dm} onToggle={() => toggle("dm")}>
          {dms?.length === 0 && !q && <li className={s.navEmpty}>아직 DM 이 없습니다</li>}
          {restDms.map(dmRow)}
          {!q && (
            <li>
              <button type="button" className={s.action} onClick={() => setDialog("dm")}>
                <PlusIcon size={16} /> 새 메시지
              </button>
            </li>
          )}
        </Section>
      </div>

      {dialog === "create" && <CreateChannelDialog onClose={() => setDialog(null)} onCreated={openChannel} />}
      {dialog === "browse" && (
        <BrowseChannelsDialog onClose={() => setDialog(null)} onOpen={openChannel} onCreate={() => setDialog("create")} />
      )}
      {dialog === "dm" && (
        <NewDmDialog
          onClose={() => setDialog(null)}
          onStarted={(id, name) => {
            setChannel({ id, name, type: "dm" });
            setDialog(null);
          }}
        />
      )}
    </nav>
  );
}

function Section({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={s.navSection}>
      <button type="button" className={s.navSectionHead} aria-expanded={open} onClick={onToggle}>
        {icon && <span className={s.favIcon}>{icon}</span>}
        <span>{title}</span>
        <ChevronIcon open={!open} />
      </button>
      {open && <ul className={s.navRows}>{children}</ul>}
    </section>
  );
}

function Row({
  id,
  active,
  muted,
  label,
  icon,
  onClick,
  children,
}: {
  id: string;
  active: boolean;
  muted: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const n = useUnread(id);
  const show = !active && n > 0;
  return (
    <li>
      <button
        type="button"
        className={`${s.row} ${active ? s.rowActive : ""} ${show ? s.rowUnread : ""}`}
        aria-current={active ? "page" : undefined}
        aria-label={show ? `${label}, 안 읽은 메시지 ${n}개` : label}
        onClick={onClick}
      >
        <span className={s.rowIcon}>{icon}</span>
        {children}
        {muted && (
          <span className={s.rowMuted} title="알림 꺼짐">
            <BellOffIcon size={14} />
          </span>
        )}
        {show && (
          <span className={s.rowBadge} aria-hidden="true">
            {n > 99 ? "99+" : n}
          </span>
        )}
      </button>
    </li>
  );
}
