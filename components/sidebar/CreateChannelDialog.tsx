"use client";

// ② 채널 만들기. 이름과 공개·비공개를 고른다. 만든 사람은 바로 멤버가 된다.

import { useState } from "react";
import type { ChannelSummary } from "@/lib/types/channel";
import { NAME_MAX, channelNameProblem, createChannel } from "./channelSource";
import Modal from "./Modal";
import s from "./sidebar.module.css";

export default function CreateChannelDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: ChannelSummary) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"public" | "private">("public");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = name.trim() ? channelNameProblem(name) : null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onCreated(await createChannel({ name, type }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="채널 만들기"
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving && name.trim() && !problem) void save();
        }}
      >
        <h2>채널 만들기</h2>
        <label className={s.field}>
          <span>이름</span>
          <input
            autoFocus
            maxLength={NAME_MAX + 5}
            placeholder="예: 신규 프로젝트"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {problem && <p className={s.hint}>{problem}</p>}

        <fieldset className={s.choice}>
          <legend>공개 범위</legend>
          <label>
            <input
              type="radio"
              name="type"
              checked={type === "public"}
              onChange={() => setType("public")}
            />
            <span>
              <strong>공개</strong> — 누구나 찾아서 들어올 수 있습니다
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="type"
              checked={type === "private"}
              onChange={() => setType("private")}
            />
            <span>
              <strong>비공개</strong> — 초대받은 사람만 보입니다 (만든 사람이 리더가 되고, 리더·부리더가 채널 정보에서 초대)
            </span>
          </label>
        </fieldset>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <div className={s.actions}>
          <button type="button" className={s.secondary} onClick={onClose}>
            닫기
          </button>
          <button
            type="submit"
            className={s.primary}
            disabled={saving || !name.trim() || Boolean(problem)}
          >
            {saving ? "만드는 중…" : "만들기"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
