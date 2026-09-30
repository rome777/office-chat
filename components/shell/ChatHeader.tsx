"use client";

// 채팅 머리: 채널 이름·즐겨찾기 별·설명 | 연결 상태·멤버 수·패널 버튼(③).
// 멤버 수 버튼은 "총인원 45명 · 접속 4명 ●2 ●1 ●1", DM 설명 줄 끝에는 "● 자리 비움 · 외근 중" (② PresenceSummary, 2026-09-30 김송이).
// 연결 상태(①)는 재연결 중·끊김일 때만 뜬다.
// DM 이면 상대 사진과 소속을 보이고, 이름을 누르면 프로필 카드가 뜬다.
// 좁은 화면에서는 메시지 목록 칸이 숨으므로 ② 의 채널 전환(ChannelTitle)을 대신 보인다.

import { useEffect, useRef, useState } from "react";
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
    <header className={s.chatHead}>
      <div className={s.mobileTitle}>
        <ChannelTitle />
      </div>
      <div className={s.headMain}>
        <span className={s.tile} aria-hidden="true">
          {isDm && other ? <PersonAvatar userId={other.id} name={other.display_name} size={40} /> : <HashIcon size={22} />}
        </span>
        <div className={s.headText}>
          <div className={s.headNameRow}>
            {isDm && other ? (
              <button type="button" className={s.headNameButton} onClick={() => openProfileCard(other.id)}>
                <h1 className={s.headName}>{channel.name}</h1>
              </button>
            ) : (
              <h1 className={s.headName}>{channel.name}</h1>
            )}
            <button
              type="button"
              className={`${s.star} ${fav ? s.starOn : ""}`}
              aria-pressed={fav}
              aria-label={fav ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}
              title={fav ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}
              onClick={() => void star()}
            >
              <StarIcon filled={fav} size={17} />
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
      <div className={s.headTools}>
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
        <MoreMenu />
      </div>
    </header>
  );
}

/** 패널 버튼(③ 요약·할 일·잡무·채널 정보·조직도)을 "⋯" 안에 둔다 — 오른쪽 패널을 열면 채팅 칸이 좁아져서 */
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
      <button type="button" className={s.members} aria-expanded={open} aria-label="채널 도구" title="요약 · 할 일 · 잡무 · 채널 정보 · 조직도" onClick={() => setOpen((v) => !v)}>
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
