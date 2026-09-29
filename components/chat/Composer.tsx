"use client";

// ① 입력창. 첨부 버튼·@ 자동완성·말투 변환 미리보기가 여기에 붙는다.
// 채널 입력창과 스레드 패널의 답글 입력창이 같이 쓴다 (답글은 첨부 없음).

import { useRef, useState } from "react";
import { ATTACHMENT_ACCEPT, attachmentProblem, formatBytes } from "@/lib/attachments";
import { TONE_MODES, type ToneMode } from "@/lib/tone";
import SafeText from "./SafeText";
import MentionPicker, { filterMembers, mentionQueryAt } from "./MentionPicker";
import type { Member } from "./useChannelMembers";
import s from "./chat.module.css";

export default function Composer({
  placeholder,
  members,
  selfId,
  allowFiles = true,
  allowTone = true,
  onSend,
}: {
  placeholder: string;
  /** @ 자동완성 대상 (지금 채널 멤버) */
  members: Member[];
  selfId: string | null;
  allowFiles?: boolean;
  /** 말투 변환 미리보기 (PRD F6) */
  allowTone?: boolean;
  onSend: (body: string, file?: File) => void;
}) {
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // @ 자동완성: 찾는말이 시작된 자리와 찾는말, 목록에서 고른 줄
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  // 말투 변환: 고른 모드와 미리보기. 승인(보내기)을 눌러야만 바뀐 문장이 나간다
  const [toneMenu, setToneMenu] = useState(false);
  const [tone, setTone] = useState<
    | { mode: ToneMode; status: "loading" }
    | { mode: ToneMode; status: "ready"; text: string }
    | { mode: ToneMode; status: "error"; error: string }
    | null
  >(null);
  const toneRequestRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // 첨부만 있고 글이 없어도 보낼 수 있다
  const canSend = draft.trim().length > 0 || file !== null;
  const candidates = mention ? filterMembers(members, mention.query, selfId) : [];

  function updateMention(text: string, caret: number) {
    const found = mentionQueryAt(text, caret);
    setMention(found);
    if (found?.query !== mention?.query) setActive(0);
  }

  function pickMention(m: Member) {
    if (!mention) return;
    const caret = mention.start + 1 + mention.query.length;
    const insert = `@${m.handle} `;
    const next = draft.slice(0, mention.start) + insert + draft.slice(caret);
    setDraft(next);
    setMention(null);
    const at = mention.start + insert.length;
    requestAnimationFrame(() => textRef.current?.setSelectionRange(at, at));
  }

  function pick(chosen: File | undefined) {
    if (!chosen) return;
    // 올리기 전에 거른다 (5MB 초과는 저장 전에 막힌다). 서버가 파일 내용으로 다시 검사한다
    const problem = attachmentProblem(chosen);
    setFileError(problem);
    setFile(problem ? null : chosen);
  }

  function clearFile() {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function reset() {
    setDraft("");
    setMention(null);
    setTone(null);
    toneRequestRef.current++;
    clearFile();
  }

  function submit(body = draft) {
    if (!body.trim() && !file) return;
    onSend(body, file ?? undefined);
    reset();
  }

  async function convert(mode: ToneMode) {
    setToneMenu(false);
    const text = draft.trim();
    if (!text) return;
    const request = ++toneRequestRef.current;
    setTone({ mode, status: "loading" });
    try {
      const res = await fetch("/api/ai/tone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (request !== toneRequestRef.current) return; // 그사이 새로 요청했거나 닫았다
      if (!res.ok || typeof data.text !== "string") {
        setTone({ mode, status: "error", error: data.error ?? "말투를 바꾸지 못했습니다" });
      } else {
        setTone({ mode, status: "ready", text: data.text });
      }
    } catch {
      if (request === toneRequestRef.current) setTone({ mode, status: "error", error: "AI 서버에 연결하지 못했습니다" });
    }
  }

  function closeTone() {
    toneRequestRef.current++;
    setTone(null);
  }

  return (
    <form
      className={s.composer}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {tone && (
        <div className={s.tonePreview} role="status">
          <div className={s.toneHead}>
            <strong>{TONE_MODES[tone.mode].label} 말투 미리보기</strong>
            <span className="muted">보내기 전에 확인하세요. 승인해야 전송됩니다</span>
          </div>
          {tone.status === "loading" && <p className="muted">바꾸는 중…</p>}
          {tone.status === "ready" && (
            <p className={s.toneText}>
              <SafeText text={tone.text} />
            </p>
          )}
          {tone.status === "error" && <p className="error-text">{tone.error}</p>}
          <div className={s.toneActions}>
            {tone.status === "ready" && (
              <button type="button" className={s.primary} onClick={() => submit(tone.text)}>
                이걸로 보내기
              </button>
            )}
            <button type="button" className="link" onClick={() => submit()} disabled={!canSend}>
              원래 문장 보내기
            </button>
            <button type="button" className="link" onClick={closeTone}>
              닫기
            </button>
          </div>
        </div>
      )}
      {(file || fileError) && (
        <div className={s.fileRow}>
          {file && (
            <span className={s.fileChip}>
              📎 {file.name} <span className="muted">({formatBytes(file.size)})</span>
              <button type="button" className="link" onClick={clearFile} aria-label="첨부 빼기">
                빼기
              </button>
            </span>
          )}
          {fileError && <span className="error-text">{fileError}</span>}
        </div>
      )}
      <div className={s.composerRow}>
        {allowFiles && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              hidden
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <button
              type="button"
              className={s.attachButton}
              onClick={() => fileInputRef.current?.click()}
              aria-label="파일 첨부"
              title="파일 첨부 (PNG·JPEG·PDF, 5MB 이하)"
            >
              📎
            </button>
          </>
        )}
        {allowTone && (
          <div className={s.toneWrap}>
            <button
              type="button"
              className={s.attachButton}
              onClick={() => setToneMenu((v) => !v)}
              disabled={draft.trim().length === 0}
              aria-haspopup="menu"
              aria-expanded={toneMenu}
              title="말투 변환 (신하·선비·정중) — 미리 보고 승인해야 전송"
            >
              🎭
            </button>
            {toneMenu && (
              <ul className={s.toneMenu} role="menu">
                {(Object.keys(TONE_MODES) as ToneMode[]).map((m) => (
                  <li key={m}>
                    <button type="button" role="menuitem" onClick={() => void convert(m)}>
                      <strong>{TONE_MODES[m].label}</strong> <span className="muted">{TONE_MODES[m].hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className={s.textWrap}>
          <MentionPicker items={candidates} active={active} onPick={pickMention} />
          <textarea
            ref={textRef}
            rows={1}
            placeholder={placeholder}
            value={draft}
            maxLength={2000}
            onChange={(e) => {
              setDraft(e.target.value);
              updateMention(e.target.value, e.target.selectionStart);
              // 원문을 고치면 미리보기는 더 이상 맞지 않는다
              if (tone) closeTone();
            }}
            onSelect={(e) => updateMention(e.currentTarget.value, e.currentTarget.selectionStart)}
            onBlur={() => setMention(null)}
            onKeyDown={(e) => {
              // 한글 조합 중 Enter 는 조합 확정이므로 전송하지 않는다 (두 번 전송 방지)
              if (e.nativeEvent.isComposing) return;
              if (candidates.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  setActive((i) => (i + step + candidates.length) % candidates.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickMention(candidates[Math.min(active, candidates.length - 1)]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <button type="submit" disabled={!canSend}>
          전송
        </button>
      </div>
    </form>
  );
}
