"use client";

// ② 헤더 왼쪽의 채널 이름. 누르면 채널 목록이 열린다 —
// 좁은 화면(768px 미만)에서는 왼쪽 칸이 숨으므로 여기가 채널을 바꾸는 유일한 곳이다.
// DM 이면 "@이름" 옆에 상대 상태·상태 메시지("● 자리 비움 · 외근 중")를 보인다 (2026-09-30).
// 사진은 넣지 않는다 — 왼쪽 DM 목록과 메시지마다 이미 있다.
// 2026-09-30 화면 개편(WU-35) 뒤로는 좁은 화면(768px 미만)에서만 쓰인다. 채널 접속 수는 새 헤더의 멤버 버튼이 보인다

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { usePeopleLooks } from "@/components/people/directory";
import { usePresenceStatus } from "@/components/profile/presence";
import { STATUS_LABEL } from "@/components/profile/profileSource";
import pf from "@/components/profile/profile.module.css";
import { useMyDms } from "./useChannels";
import { LockIcon } from "./ActionIcons";
import ChannelList from "./ChannelList";
import DmList from "./DmList";
import s from "./sidebar.module.css";

export default function ChannelTitle() {
  const { channel } = useWorkspace();
  const { dms } = useMyDms();
  const peer = channel.type === "dm" ? (dms?.find((d) => d.id === channel.id)?.other ?? null) : null;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const switcherId = useId();

  // 바깥을 누르거나 Esc 를 누르면 닫는다. 대화상자가 떠 있으면 대화상자만 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest?.("[data-modal]")) return; // 목록에서 연 대화상자 안
      if (box.current && !box.current.contains(target)) setOpen(false);
    };
    // 대화상자가 Esc 를 먼저 받아 preventDefault 하면 목록은 그대로 둔다
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={s.titleBox} ref={box}>
      <h1 className={s.title}>
        <button
          type="button"
          className={s.titleButton}
          aria-expanded={open}
          aria-controls={switcherId}
          aria-label={
            channel.type === "dm"
              ? `${channel.name} 님과 DM — 채널 목록`
              : `${channel.name}${channel.type === "private" ? " (비공개)" : ""} 채널 — 채널 목록`
          }
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">{channel.type === "dm" ? "@" : "#"}</span> {channel.name}
          {channel.type === "private" && (
            <span className={s.lock}>
              <LockIcon size={14} />
            </span>
          )}
          <span className={s.caret} aria-hidden="true">
            ▾
          </span>
        </button>
      </h1>
      {peer && <PeerStatus userId={peer.id} />}
      {open && (
        <div id={switcherId} className={s.switcher} role="region" aria-label="채널 바꾸기">
          <ChannelList onPicked={() => setOpen(false)} />
          <p className={s.switcherSection}>다이렉트 메시지</p>
          <DmList onPicked={() => setOpen(false)} />
          <Link href="/calendar" className={`${s.item} ${s.link} ${s.switcherCalendar}`}>
            캘린더
          </Link>
        </div>
      )}
    </div>
  );
}

// DM 상대의 상태·상태 메시지 한 줄. 오프라인이면 상태 메시지는 보이지 않는다
function PeerStatus({ userId }: { userId: string }) {
  const status = usePresenceStatus(userId);
  const message = usePeopleLooks().get(userId)?.status_message;
  return (
    <span className={s.peerStatus}>
      <span className={`${pf.swatch} ${pf[status]}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
      {status !== "offline" && message ? ` · ${message}` : ""}
    </span>
  );
}
