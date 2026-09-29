"use client";

// ① 입력창. 첨부 버튼·@ 자동완성·말투 변환 미리보기가 여기에 붙는다.

import { useRef, useState } from "react";
import { ATTACHMENT_ACCEPT, attachmentProblem, formatBytes } from "@/lib/attachments";
import s from "./chat.module.css";

export default function Composer({
  channelName,
  onSend,
}: {
  channelName: string;
  onSend: (body: string, file?: File) => void;
}) {
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 첨부만 있고 글이 없어도 보낼 수 있다
  const canSend = draft.trim().length > 0 || file !== null;

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

  function submit() {
    if (!canSend) return;
    onSend(draft, file ?? undefined);
    setDraft("");
    clearFile();
  }

  return (
    <form
      className={s.composer}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
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
      </div>
    </form>
  );
}
