"use client";

// ② 새 DM. 이름·부서로 한 사람을 찾아 대화방을 연다. 이미 대화한 사람이면 그 방이 열린다 (create_dm).

import { useEffect, useState } from "react";
import type { Person } from "@/lib/types/people";
import PeoplePicker from "@/components/people/PeoplePicker";
import { getMyUserId, startDm } from "./channelSource";
import Modal from "./Modal";
import s from "./sidebar.module.css";

export default function NewDmDialog({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (channelId: string, name: string) => void;
}) {
  const [me, setMe] = useState<string | null>(null);
  const [picked, setPicked] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other = picked[0];

  useEffect(() => {
    void getMyUserId().then(setMe, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  async function start() {
    if (!other) return;
    setBusy(true);
    setError(null);
    try {
      onStarted(await startDm(other.id), other.display_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="새 메시지"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void start();
        }}
      >
        <h2>새 메시지</h2>
        <div className={s.field}>
          <span>받는 사람</span>
          {/* 나 자신은 목록에서 뺀다 (DB 도 나와의 DM 은 거부한다) */}
          <PeoplePicker
            value={picked}
            onChange={setPicked}
            exclude={me ? [me] : []}
            max={1}
            placeholder="이름·부서로 찾기"
          />
        </div>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <div className={s.actions}>
          <button type="button" className={s.secondary} onClick={onClose}>
            닫기
          </button>
          <button type="submit" className={s.primary} disabled={!other || !me || busy}>
            {busy ? "여는 중…" : "대화 시작"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
