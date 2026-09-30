"use client";

// ② 채팅 헤더(ChatHeader)에 들어가는 접속 요약 (2026-09-30 사용자 결정)
// - 채널: "총인원 45명 · 접속 4명 ●2 ●1 ●1" — 접속은 회사 접속자 채널로 **사람**을 센다 (탭이 아니라, "오프라인으로 표시"는 빠짐)
// - DM: "● 자리 비움 · 외근 중" — 상대 상태와 상태 메시지 (오프라인이면 메시지는 숨김)

import type { DisplayStatus } from "@/lib/types/profile";
import { useChannelMembers } from "@/components/chat/useChannelMembers"; // ①
import { usePeopleLooks } from "@/components/people/directory";
import { usePresenceMap, usePresenceStatus } from "./presence";
import { STATUS_LABEL } from "./profileSource";
import s from "./profile.module.css";

const COUNTED: DisplayStatus[] = ["online", "away", "dnd"];

export type ChannelPresence = ReturnType<typeof useChannelPresence>;

/** 채널 멤버 수와 그 가운데 지금 접속한 사람 수(상태별). detail 은 "온라인 2 · 자리 비움 1 · 방해 금지 1" */
export function useChannelPresence(channelId: string) {
  const members = useChannelMembers(channelId);
  const online = usePresenceMap();
  const counts: Record<"online" | "away" | "dnd", number> = { online: 0, away: 0, dnd: 0 };
  for (const m of members) {
    const st = online.get(m.id);
    if (st === "online" || st === "away" || st === "dnd") counts[st] += 1;
  }
  const here = counts.online + counts.away + counts.dnd;
  const detail = COUNTED.map((st) => `${STATUS_LABEL[st]} ${counts[st as keyof typeof counts]}`).join(" · ");
  return { total: members.length, here, counts, detail, loaded: members.length > 0 };
}

/** "총인원 45명 · 접속 4명 ●2 ●1 ●1" (멤버를 받기 전에는 fallbackTotal 만) */
export function ChannelPresenceText({ p, fallbackTotal }: { p: ChannelPresence; fallbackTotal: number | null }) {
  if (!p.loaded) return <>{fallbackTotal ?? ""}</>;
  return (
    <span className={s.presenceText} title={p.detail}>
      총인원 {p.total}명 · 접속 {p.here}명
      {COUNTED.map((st) => (
        <span key={st} className={s.presenceCount} aria-hidden="true">
          <span className={`${s.swatch} ${s[st]}`} />
          {p.counts[st as keyof typeof p.counts]}
        </span>
      ))}
    </span>
  );
}

/** DM 상대 "● 자리 비움 · 외근 중" */
export function PeerPresenceText({ userId }: { userId: string }) {
  const status = usePresenceStatus(userId);
  const message = usePeopleLooks().get(userId)?.status_message;
  return (
    <span className={s.presenceText}>
      <span className={`${s.swatch} ${s[status]}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
      {status !== "offline" && message ? ` · ${message}` : ""}
    </span>
  );
}
