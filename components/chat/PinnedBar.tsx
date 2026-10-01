"use client";

// ① 고정 메시지 막대 — 대화 위쪽에 늘 붙어 있다 (2026-10-01 사용자 요청 "고정 메시지는 메시지방 상단에 UI 적으로 고정").
// 접힌 상태: 가장 최근에 고정한 메시지 한 줄 + 여러 개면 "1/3" 으로 넘겨 보기. ▾ 로 펼치면 고정된 메시지 전체.
// 메시지를 누르면 그 메시지로 이동해 잠깐 강조한다 (불러오지 않은 옛 메시지면 거기까지 불러온다).
// 데이터는 pins.ts — 메시지 메뉴의 📌·채널 정보 패널의 "고정된 메시지"와 같은 저장소다.

import { useState } from "react";
import { useMentionLabels } from "@/components/people/directory";
import { ChevronIcon, PinIcon } from "@/components/shell/icons";
import { showMentions } from "@/lib/mentions";
import type { Pin } from "./pins";
import s from "./chat.module.css";

const WHEN = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function PinnedBar({
  pins,
  names,
  onJump,
  onUnpin,
}: {
  /** 고정한 시각이 늦은 것부터 */
  pins: Pin[];
  /** 사람 id → 이름 */
  names: ReadonlyMap<string, string>;
  onJump: (messageId: number) => void;
  onUnpin: (messageId: number) => void;
}) {
  const labels = useMentionLabels();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  if (pins.length === 0) return null;

  const at = Math.min(index, pins.length - 1); // 고정을 풀어 개수가 줄었을 때
  const pin = pins[at];
  const who = (p: Pin) => (p.user_id && names.get(p.user_id)) || "알 수 없음";
  const text = (p: Pin) => showMentions(p.body, labels).replace(/\s+/g, " ").trim() || "(첨부 파일)";

  return (
    <div className={s.pinBar} role="region" aria-label={`고정된 메시지 ${pins.length}개`}>
      <div className={s.pinBarRow}>
        <span className={s.pinBarIcon} aria-hidden="true">
          <PinIcon size={16} />
        </span>
        <button type="button" className={s.pinBarMain} onClick={() => onJump(pin.message_id)} title="이 메시지로 이동">
          <span className={s.pinBarWho}>{who(pin)}</span>
          <span className={s.pinBarText}>{text(pin)}</span>
        </button>
        {pins.length > 1 && (
          <button
            type="button"
            className={s.pinBarStep}
            onClick={() => setIndex((at + 1) % pins.length)}
            aria-label={`다음 고정 메시지 (지금 ${at + 1}번째, 모두 ${pins.length}개)`}
            title="다음 고정 메시지"
          >
            {at + 1}/{pins.length}
          </button>
        )}
        <button
          type="button"
          className={s.pinBarToggle}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "고정된 메시지 목록 접기" : "고정된 메시지 모두 보기"}
          title={open ? "접기" : "모두 보기"}
        >
          <ChevronIcon open={open} size={16} />
        </button>
      </div>
      {open && (
        <ul className={s.pinBarList}>
          {pins.map((p) => (
            <li key={p.message_id}>
              <button
                type="button"
                className={s.pinBarItem}
                onClick={() => {
                  setOpen(false);
                  onJump(p.message_id);
                }}
              >
                <span className={s.pinBarMeta}>
                  <strong>{who(p)}</strong> · {WHEN.format(new Date(p.created_at))}
                </span>
                <span className={s.pinBarItemText}>{text(p)}</span>
              </button>
              <button type="button" className={`link ${s.pinBarUnpin}`} onClick={() => onUnpin(p.message_id)}>
                고정 해제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
