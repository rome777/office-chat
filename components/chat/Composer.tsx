"use client";

// ① 입력창. 첨부 버튼·@ 자동완성·말투 변환 미리보기가 여기에 붙는다.

import { useState } from "react";
import s from "./chat.module.css";

export default function Composer({
  channelName,
  onSend,
}: {
  channelName: string;
  onSend: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0;

  function submit() {
    if (!canSend) return;
    onSend(draft);
    setDraft("");
  }

  return (
    <form
      className={s.composer}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        rows={1}
        placeholder={`#${channelName} 에 메시지 보내기 (Enter 전송, Shift+Enter 줄바꿈)`}
        value={draft}
        maxLength={2000}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // 한글 조합 중 Enter 는 조합 확정이므로 전송하지 않는다 (두 번 전송 방지)
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="submit" disabled={!canSend}>
        전송
      </button>
    </form>
  );
}
