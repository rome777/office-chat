"use client";

// ② 비밀번호 바꾸기 — 지금 비밀번호로 본인인지 확인한 뒤 새 비밀번호로 바꾼다 (profileSource.changePassword)

import { useState, type FormEvent } from "react";
import Modal from "@/components/sidebar/Modal";
import ui from "@/components/sidebar/sidebar.module.css";
import { changePassword } from "./profileSource";

const MIN_PASSWORD = 6; // 가입 화면(LoginForm)과 같은 Supabase 기본 최소 길이

export default function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!current) return setError("지금 비밀번호를 넣으세요");
    if (next.length < MIN_PASSWORD) return setError(`새 비밀번호는 ${MIN_PASSWORD}자 이상입니다`);
    if (next !== again) return setError("새 비밀번호 두 칸이 다릅니다");
    if (next === current) return setError("지금 비밀번호와 다른 비밀번호를 쓰세요");
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className={ui.dialog} role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onSubmit={submit}>
        <h2 id="password-dialog-title">비밀번호 바꾸기</h2>
        {done ? (
          <>
            <p>비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요.</p>
            <div className={ui.actions}>
              <button type="button" className={ui.primary} onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <label className={ui.field}>
              지금 비밀번호
              <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
            </label>
            <label className={ui.field}>
              새 비밀번호 ({MIN_PASSWORD}자 이상)
              <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
            <label className={ui.field}>
              새 비밀번호 한 번 더
              <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            </label>
            {error && <p className="error-text">{error}</p>}
            <div className={ui.actions}>
              <button type="button" className={ui.secondary} onClick={onClose}>
                취소
              </button>
              <button type="submit" className={ui.primary} disabled={busy}>
                {busy ? "바꾸는 중…" : "바꾸기"}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
