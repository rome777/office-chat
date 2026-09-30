"use client";

// 프로필 카드 — 메시지 작성자·채널 멤버·조직도·DM 목록에서 사람을 누르면 뜬다.
// 사진·상태 메시지·소속은 명단(profiles), 상태는 접속자 채널(presence, 남의 status 칸은 읽을 수 없다),
// 연락처는 공개한 사람 것만 (profile_contacts RLS). 이메일은 본인 것만 보인다 (남의 로그인 메일은 DB 가 주지 않는다).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DisplayStatus } from "@/lib/types/profile";
import { unitChain } from "@/lib/mentions";
import { getSupabase } from "@/lib/supabase";
import { useOrgUnits } from "@/components/people/directory";
import Avatar from "@/components/profile/Avatar";
import { usePresenceStatus } from "@/components/profile/presence";
import { STATUS_LABEL, useMyProfile } from "@/components/profile/profileSource";
import { startDm } from "@/components/sidebar/channelSource";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { BuildingIcon, CalendarIcon, ChatBubbleIcon, EditIcon, MailIcon, PhoneIcon } from "./icons";
import { closeProfileCard, useOpenProfileCard } from "./cardStore";
import s from "./card.module.css";

type Card = {
  id: string;
  handle: string;
  display_name: string;
  department: string | null;
  title: string | null;
  org_unit_id: string | null;
  avatar: string | null;
  status_message: string;
  phone: string | null;
};

const SHOWN: Record<DisplayStatus, string> = { ...STATUS_LABEL, invisible: "오프라인", offline: "오프라인" };

export default function ProfileCardHost() {
  const userId = useOpenProfileCard();
  if (!userId) return null;
  return <ProfileCard key={userId} userId={userId} />;
}

function ProfileCard({ userId }: { userId: string }) {
  const router = useRouter();
  const { setChannel, openPanel } = useWorkspace();
  const { profile: mine } = useMyProfile();
  const presence = usePresenceStatus(userId);
  const units = useOrgUnits();
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isMe = mine?.id === userId;

  useEffect(() => {
    let alive = true;
    const supabase = getSupabase();
    void Promise.all([
      supabase
        .from("profiles")
        .select("id, handle, display_name, department, title, org_unit_id, avatar, status_message")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("profile_contacts").select("phone").eq("user_id", userId).maybeSingle(),
    ]).then(([p, c]) => {
      if (!alive) return;
      if (p.error || !p.data) return setError(p.error?.message ?? "찾을 수 없는 사람입니다");
      setCard({ ...(p.data as Omit<Card, "phone">), phone: (c.data?.phone as string | undefined) || null });
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeProfileCard();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const path = useMemo(() => {
    if (!card) return "";
    const byId = new Map(units.map((u) => [u.id, u]));
    const chain = unitChain(card.org_unit_id, units).map((id) => byId.get(id)!).reverse();
    const shown = chain.length > 1 ? chain.filter((u) => u.parent_id) : chain;
    return shown.map((u) => u.name).join(" › ") || card.department || "";
  }, [card, units]);

  // 나는 내 프로필 창구의 값(바꾸자마자, "오프라인으로 표시"도 그대로)을, 남은 접속자 채널의 값을 쓴다
  const status: DisplayStatus = isMe ? (mine?.status ?? "online") : presence;
  const statusMessage = isMe ? (mine?.status_message ?? "") : (card?.status_message ?? "");

  async function message() {
    if (!card) return;
    setBusy(true);
    try {
      const id = await startDm(card.id);
      setChannel({ id, name: card.display_name, type: "dm" });
      closeProfileCard();
      router.push("/chat");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className={s.backdrop} onClick={closeProfileCard}>
      <section
        className={s.card}
        role="dialog"
        aria-modal="true"
        aria-label={card ? `${card.display_name} 프로필` : "프로필"}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={s.close} onClick={closeProfileCard} aria-label="닫기">
          ✕
        </button>
        {error && <p className="error-text">{error}</p>}
        {!card && !error && <p className="muted">불러오는 중…</p>}
        {card && (
          <>
            <header className={s.head}>
              <Avatar name={card.display_name} avatar={isMe ? (mine?.avatar ?? null) : card.avatar} size={64} status={status} />
              <div className={s.headText}>
                <div className={s.nameRow}>
                  <strong className={s.name}>{card.display_name}</strong>
                  <span className={`${s.status} ${s[status]}`}>{SHOWN[status]}</span>
                </div>
                <span className={s.sub}>{[card.department, card.title].filter(Boolean).join(" · ") || "소속 없음"}</span>
                <span className={s.handle}>@{card.handle}</span>
              </div>
            </header>

            <ul className={s.rows}>
              {path && (
                <li>
                  <BuildingIcon size={16} /> {path}
                </li>
              )}
              {isMe && mine?.email && (
                <li>
                  <MailIcon size={16} /> {mine.email}
                </li>
              )}
              {card.phone && (
                <li>
                  <PhoneIcon size={16} /> {card.phone}
                </li>
              )}
            </ul>

            <div className={s.statusBox}>
              <p className={s.statusHead}>
                <ChatBubbleIcon size={16} /> 상태 메시지
              </p>
              <p className={s.statusText}>{statusMessage || <span className="muted">상태 메시지가 없습니다</span>}</p>
            </div>

            <div className={s.actions}>
              {isMe ? (
                <button
                  type="button"
                  className={s.primary}
                  onClick={() => {
                    closeProfileCard();
                    openPanel({ kind: "profile" });
                  }}
                >
                  <EditIcon size={16} /> 내 프로필 편집
                </button>
              ) : (
                <button type="button" className={s.primary} disabled={busy} onClick={() => void message()}>
                  <ChatBubbleIcon size={16} /> {busy ? "여는 중…" : "메시지"}
                </button>
              )}
              <button
                type="button"
                className={s.secondary}
                onClick={() => {
                  closeProfileCard();
                  router.push(isMe ? "/calendar?new=1" : `/calendar?new=1&with=${encodeURIComponent(card.id)}`);
                }}
              >
                <CalendarIcon size={16} /> 일정 잡기
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
