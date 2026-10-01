"use client";

// 채팅 머리: 채널 이름·즐겨찾기 별·설명 | 연결 상태·멤버 수·패널 버튼(③).
// 멤버 수 버튼은 "총인원 45명 · 접속 4명 ●2 ●1 ●1", DM 설명 줄 끝에는 "● 자리 비움 · 외근 중" (② PresenceSummary, 2026-09-30 김송이).
// 연결 상태(①)는 재연결 중·끊김일 때만 뜬다.
// DM 이면 상대 사진과 소속을 보이고, 이름을 누르면 프로필 카드가 뜬다.
// 좁은 화면에서는 메시지 목록 칸이 숨으므로 ② 의 채널 전환(ChannelTitle)을 대신 보인다.
// 즐겨찾기 버튼은 "☆ 즐겨찾기" 인데, 오른쪽 패널(채널 정보 등)이 열리거나 이름이 길어 이름이 다 안 보이면 "☆" 만 둔다 (2026-10-01 사용자 요청).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ConnectionStatus from "@/components/chat/ConnectionStatus"; // ①
import HeaderActions from "@/components/panel/HeaderActions"; // ③
import PersonAvatar from "@/components/profile/PersonAvatar";
import { ChannelPresenceText, PeerPresenceText, useChannelPresence } from "@/components/profile/PresenceSummary"; // ②
import ChannelTitle from "@/components/sidebar/ChannelTitle"; // ②
import { useMyChannels, useMyDms } from "@/components/sidebar/useChannels";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useChannelDetails } from "./channelDetails";
import { toggleFavorite, useFavorites } from "./favorites";
import { HashIcon, StarIcon, UsersIcon } from "./icons";
import { openProfileCard } from "./cardStore";
import s from "./chat.module.css";

export default function ChatHeader() {
  const { channel, panel, openPanel, closePanel } = useWorkspace();
  const { channels } = useMyChannels();
  const { dms } = useMyDms();
  const details = useChannelDetails(channel.id);
  const favorites = useFavorites();
  const [error, setError] = useState<string | null>(null);
  const isDm = channel.type === "dm";
  const other = isDm ? dms?.find((d) => d.id === channel.id)?.other : undefined;
  const count = channels?.find((c) => c.id === channel.id)?.member_count ?? null;
  const fav = favorites.has(channel.id);
  const presence = useChannelPresence(isDm ? "" : channel.id); // DM 은 세지 않는다 (빈 id 면 불러오지 않음)
  const fit = useStarFit(channel.name, fav);

  async function star() {
    setError(null);
    try {
      await toggleFavorite(channel.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const infoOpen = panel?.kind === "channelInfo";

  return (
    <header className={s.chatHead} ref={fit.head}>
      <div className={s.mobileTitle}>
        <ChannelTitle />
        <button
          type="button"
          className={`${s.star} ${s.starIconOnly} ${fav ? s.starOn : ""}`}
          aria-pressed={fav}
          aria-label={fav ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}
          onClick={() => void star()}
        >
          <StarIcon filled={fav} size={16} />
        </button>
      </div>
      <div className={s.headMain}>
        <span className={s.tile} aria-hidden="true" ref={fit.tile}>
          {isDm && other ? <PersonAvatar userId={other.id} name={other.display_name} size={40} /> : <HashIcon size={22} />}
        </span>
        <div className={s.headText}>
          <div className={s.headNameRow}>
            {isDm && other ? (
              <button type="button" className={s.headNameButton} onClick={() => openProfileCard(other.id)}>
                <h1 className={s.headName} ref={fit.name}>
                  {channel.name}
                </h1>
              </button>
            ) : (
              <h1 className={s.headName} ref={fit.name}>
                {channel.name}
              </h1>
            )}
            <button
              type="button"
              ref={fit.star}
              className={`${s.star} ${fav ? s.starOn : ""} ${fit.compact ? s.starIconOnly : ""}`}
              aria-pressed={fav}
              aria-label={fav ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}
              title={fav ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}
              onClick={() => void star()}
            >
              <StarIcon filled={fav} size={15} />
              {!fit.compact && <span className={s.starText}>{fav ? "즐겨찾기됨" : "즐겨찾기"}</span>}
            </button>
          </div>
          <p className={s.headDesc}>
            {error ? (
              <span className="error-text">{error}</span>
            ) : isDm ? (
              <>
                {[other?.department, other?.title].filter(Boolean).join(" · ") || "1:1 대화"}
                {other && (
                  <>
                    {" · "}
                    <PeerPresenceText userId={other.id} />
                  </>
                )}
              </>
            ) : (
              details?.description || <span className="muted">{channel.type === "private" ? "비공개 채널" : "공개 채널"}</span>
            )}
          </p>
        </div>
      </div>
      <div className={s.headTools} ref={fit.tools}>
        <ConnectionStatus />
        {!isDm && (
          <button
            type="button"
            className={`${s.members} ${infoOpen ? s.membersOn : ""}`}
            aria-pressed={infoOpen}
            onClick={() => (infoOpen ? closePanel() : openPanel({ kind: "channelInfo" }))}
            aria-label={
              presence.loaded
                ? `총인원 ${presence.total}명, 접속 ${presence.here}명 (${presence.detail}) — 채널 정보`
                : `멤버 ${count ?? ""}명 — 채널 정보`
            }
          >
            <UsersIcon size={18} />
            <ChannelPresenceText p={presence} fallbackTotal={count} />
          </button>
        )}
        {/* 채널을 바꾸면 새로 그려 드롭다운이 닫힌다 */}
        <MoreMenu key={channel.id} />
      </div>
    </header>
  );
}

/**
 * 즐겨찾기 버튼에 글자를 붙여도 채널 이름이 다 보이는가. 보이지 않으면 compact = true ("☆" 만).
 * 이름 칸의 폭은 내용에 따라 줄었다 늘었다 해서 그것으로 재면 글자를 뺐다 붙였다 깜빡인다 →
 * 머리 전체 폭에서 오른쪽 도구·아이콘 칸을 뺀 "쓸 수 있는 폭"과, 이름 원래 폭 + 글자 붙은 버튼 폭을 비교한다
 */
function useStarFit(name: string, fav: boolean) {
  const head = useRef<HTMLElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const tile = useRef<HTMLSpanElement>(null);
  const nameEl = useRef<HTMLHeadingElement>(null);
  const star = useRef<HTMLButtonElement>(null);
  const full = useRef(0); // 글자가 붙은 버튼 폭 (글자가 보일 때 잰다)
  const [compact, setCompact] = useState(false);
  const compactNow = useRef(compact);
  compactNow.current = compact;

  useLayoutEffect(() => {
    const h = head.current;
    if (!h) return;
    const check = () => {
      if (!nameEl.current || !star.current || !tools.current) return;
      if (!compactNow.current) full.current = star.current.offsetWidth;
      const cs = getComputedStyle(h);
      const gap = parseFloat(cs.columnGap) || 12; // 머리 칸 사이 = 아이콘·이름 사이 간격
      const room =
        h.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - tools.current.offsetWidth - gap - (tile.current?.offsetWidth ?? 44) - gap;
      const need = nameEl.current.scrollWidth + 6 + (full.current || 96); // 6 = 이름과 버튼 사이
      setCompact(nameEl.current.offsetParent !== null && need > room);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(h);
    if (tools.current) ro.observe(tools.current);
    return () => ro.disconnect();
  }, [name, fav]);

  return { head, tools, tile, name: nameEl, star, compact };
}

/** 패널 버튼(③ 요약·할 일·잡무·채널 정보)을 "⋯" 안에 둔다 — 오른쪽 패널을 열면 채팅 칸이 좁아져서 */
function MoreMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={s.more} ref={box}>
      <button type="button" className={s.members} aria-expanded={open} aria-label="채널 도구" title="요약 · 할 일 · 잡무 · 채널 정보" onClick={() => setOpen((v) => !v)}>
        ⋯
      </button>
      {open && (
        <div className={s.moreMenu} onClick={() => setOpen(false)}>
          <HeaderActions />
        </div>
      )}
    </div>
  );
}
