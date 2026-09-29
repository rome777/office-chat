"use client";

// ② 채널·DM 목록의 한 줄 버튼. 미읽음 숫자를 붙이고, 화면 낭독기에는 이름과 함께 읽어 준다.
// 지금 보고 있는 대화에는 숫자를 띄우지 않는다 (보는 동안 ① 이 읽음을 남긴다)

import type { ReactNode } from "react";
import { useUnread } from "./useChannels";
import s from "./sidebar.module.css";

export default function ChannelRowButton({
  channelId,
  label,
  active,
  onClick,
  children,
}: {
  channelId: string;
  /** 화면 낭독기가 읽을 이름 (예: "프로젝트 (비공개)", "사용자A 님과 DM") */
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const n = useUnread(channelId);
  const show = !active && n > 0;
  return (
    <button
      type="button"
      className={`${s.item} ${s.channelButton} ${active ? s.active : ""} ${show ? s.hasUnread : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={show ? `${label}, 안 읽은 메시지 ${n}개` : label}
      onClick={onClick}
    >
      {children}
      {show && (
        <span className={s.badge} aria-hidden="true">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </button>
  );
}
