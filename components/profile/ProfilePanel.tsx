"use client";

// ② 오른쪽 패널의 "내 프로필". 왼쪽 메뉴의 "설정"·내 카드, 헤더의 내 메뉴, 내 프로필 카드에서 연다.
// 2026-09-30 사용자와 정한 모양 (와이어프레임 5차 + 연락처 줄 정리):
//   위: 사진 · 이름 · 부서·직급 · [사진 바꾸기]
//   현재 상태: 버튼 3개(누르면 바로 저장) · 상태 메시지(제목 줄 오른쪽 [저장], Enter 도 됨, 비우고 저장하면 지움)
//   기본 정보: 글자로만(인사 정보라 고칠 수 없음) + 맨 아래 연락처 — 연락처만 [수정] → 빠짐없는 번호를 넣어야 [저장], 공개·비공개는 언제든 바로 저장
//   계정 관리: 아이디 · 비밀번호 [변경] · [로그아웃]
// 전체 [변경사항 저장] 버튼은 두지 않는다 — 부분마다 따로 저장된다.
// "오프라인으로 표시"는 헤더의 내 메뉴에서만 고른다. 그 상태면 상태 버튼 셋이 모두 꺼지고 안내 줄이 뜬다.
// 아이디는 WU-31 에서 "화면에 보이지 않는다"로 정했지만, 여기는 나만 보는 계정 정보라 예외로 보인다 (2026-09-30 사용자 결정).

import { useMemo, useState, type ReactNode } from "react";
import type { Status } from "@/lib/types/profile";
import { unitChain } from "@/lib/mentions";
import { useOrgUnits } from "@/components/people/directory";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import Avatar from "./Avatar";
import AvatarDialog from "./AvatarDialog";
import PasswordDialog from "./PasswordDialog";
import {
  STATUS_LABEL,
  STATUS_MESSAGE_MAX,
  normalizePhone,
  saveContact,
  updateMyProfile,
  useMyProfile,
} from "./profileSource";
import s from "./myProfile.module.css";

const PANEL_STATUSES: Status[] = ["online", "away", "dnd"];
const MESSAGE_HINT = "메시지를 지우려면 입력칸을 비운 채로 저장하세요";

export default function ProfilePanel() {
  const { profile, contact, error } = useMyProfile();
  const { signOut } = useWorkspace();
  const [dialog, setDialog] = useState<"avatar" | "password" | null>(null);

  if (error) return <p className="error-text">{error}</p>;
  if (!profile || !contact) return <p className="muted">불러오는 중…</p>;

  return (
    <div className={s.panel}>
      <section className={s.top}>
        <Avatar name={profile.display_name} avatar={profile.avatar} size={64} status={profile.status} />
        <div className={s.who}>
          <strong className={s.name}>{profile.display_name}</strong>
          <span className={s.dept}>{[profile.department, profile.title].filter(Boolean).join(" · ") || "소속 없음"}</span>
          <button type="button" className={`${s.btn} ${s.photoBtn}`} onClick={() => setDialog("avatar")}>
            <CameraIcon />
            사진 바꾸기
          </button>
        </div>
      </section>

      <StatusSection key={profile.id} status={profile.status} message={profile.status_message} />

      <section className={s.section} aria-labelledby="profile-basic">
        <div className={s.head}>
          <h3 id="profile-basic">기본 정보</h3>
          <span className={s.tag}>
            <LockIcon /> 인사 정보
          </span>
        </div>
        <dl className={s.rows}>
          <Row label="이름" value={profile.display_name} />
          <Row label="부서" value={<OrgPath unitId={profile.org_unit_id} fallback={profile.department} />} />
          <Row label="직급" value={profile.title ?? "—"} />
          <Row label="이메일" value={profile.email ?? "—"} />
        </dl>
        <ContactRow phone={contact.phone} isPublic={contact.is_public} />
        <p className={s.note}>연락처 외 나머지는 인사팀에 요청하세요.</p>
      </section>

      <section className={s.section} aria-labelledby="profile-account">
        <div className={s.head}>
          <h3 id="profile-account">계정 관리</h3>
        </div>
        <dl className={s.rows}>
          <Row label="아이디" value={profile.handle} />
        </dl>
        <div className={s.row}>
          <span className={s.key}>비밀번호</span>
          <button type="button" className={s.btn} onClick={() => setDialog("password")}>
            변경
          </button>
        </div>
        <div className={s.row}>
          <span className={s.key}>로그아웃</span>
          <button type="button" className={s.btn} onClick={signOut}>
            로그아웃
          </button>
        </div>
      </section>

      {dialog === "avatar" && <AvatarDialog me={profile} onClose={() => setDialog(null)} />}
      {dialog === "password" && <PasswordDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={s.row}>
      <dt className={s.key}>{label}</dt>
      <dd className={s.value}>{value}</dd>
    </div>
  );
}

// 현재 상태: 버튼을 누르면 바로 저장. 상태 메시지는 [저장]·Enter 로 저장, 비우고 저장하면 지운다
function StatusSection({ status, message }: { status: Status; message: string }) {
  const [draft, setDraft] = useState(message);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastMessage, setLastMessage] = useState(message);
  // 저장한 값(또는 실패해서 되돌아간 값)이 바뀌면 입력칸도 따라간다
  if (message !== lastMessage) {
    setLastMessage(message);
    setDraft(message);
  }

  async function run(patch: Parameters<typeof updateMyProfile>[0], done: string) {
    setNote(null);
    try {
      await updateMyProfile(patch);
      setNote({ ok: true, text: done });
      setTimeout(() => setNote((v) => (v?.text === done ? null : v)), 1500);
    } catch (e) {
      setNote({ ok: false, text: `저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const unchanged = draft.trim() === message;
  const saveMessage = () => {
    const next = draft.trim();
    void run({ status_message: next }, next ? "상태 메시지를 저장했어요" : "상태 메시지를 지웠어요");
  };

  return (
    <section className={s.section} aria-labelledby="profile-status">
      <div className={s.head}>
        <h3 id="profile-status">현재 상태</h3>
        <span className={`${s.tag} ${s.tagAccent}`}>누르면 바로 적용</span>
      </div>
      <div className={s.statusRow} role="radiogroup" aria-label="현재 상태">
        {PANEL_STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            role="radio"
            aria-checked={status === st}
            className={`${s.chip} ${status === st ? s.chipOn : ""}`}
            onClick={() => status !== st && void run({ status: st }, `${STATUS_LABEL[st]}(으)로 바꿨어요`)}
          >
            <span className={`${s.swatch} ${s[st]}`} aria-hidden="true" />
            {STATUS_LABEL[st]}
          </button>
        ))}
      </div>
      {status === "invisible" && (
        <p className={s.offNote}>
          <span className={`${s.swatch} ${s.invisible}`} aria-hidden="true" />
          오프라인으로 표시 중 · 위 버튼을 누르면 풀림
        </p>
      )}
      <div className={s.labelRow}>
        <label className={s.label} htmlFor="profile-status-message">
          상태 메시지
        </label>
        <button type="button" className={`${s.btn} ${s.small}`} onClick={saveMessage} disabled={unchanged}>
          저장
        </button>
      </div>
      <input
        id="profile-status-message"
        className={s.input}
        value={draft}
        maxLength={STATUS_MESSAGE_MAX}
        placeholder="외근 중 · 15시 복귀"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return; // 한글 조합 중 Enter (TECH_SPEC 13절)
          if (e.key === "Enter" && !unchanged) saveMessage();
          if (e.key === "Escape") setDraft(message);
        }}
      />
      <p className={s.note} aria-live="polite">
        {note ? <span className={note.ok ? undefined : "error-text"}>{note.text}</span> : MESSAGE_HINT}
      </p>
    </section>
  );
}

// 연락처: [수정]을 누르면 번호가 입력칸이 되고 버튼이 [저장]으로 바뀐다. 빠짐없는 번호를 넣어야만 [저장]이 눌린다.
// 공개·비공개는 [수정]과 따로, 언제든 누르면 바로 저장된다 (2026-09-30 사용자 결정)
function ContactRow({ phone, isPublic }: { phone: string; isPublic: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = normalizePhone(draft);
  const canSave = !!normalized && normalized !== phone;

  function start() {
    setDraft(phone);
    setEditing(true);
    setError(null);
  }

  function cancel() {
    setDraft(phone);
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (!canSave || !normalized) return;
    setBusy(true);
    setError(null);
    try {
      await saveContact({ phone: normalized, is_public: isPublic });
      setEditing(false);
    } catch (e) {
      setError(`저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function setPublic(v: boolean) {
    if (v === isPublic) return;
    setBusy(true);
    setError(null);
    try {
      await saveContact({ phone, is_public: v }); // 저장된 번호 그대로, 공개 여부만
    } catch (e) {
      setError(`바꾸지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.contact}>
      <div className={s.row}>
        <span className={s.key}>
          연락처
          {editing ? (
            <button type="button" className={`${s.btn} ${s.small} ${s.primary}`} onClick={() => void save()} disabled={busy || !canSave}>
              {busy ? "저장 중…" : "저장"}
            </button>
          ) : (
            <button type="button" className={`${s.btn} ${s.small}`} onClick={start} disabled={busy}>
              수정
            </button>
          )}
        </span>
        {editing ? (
          <input
            className={s.phone}
            type="tel"
            inputMode="tel"
            value={draft}
            placeholder="010-1234-5678"
            aria-label="연락처"
            aria-invalid={draft.trim() !== "" && !normalized}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") void save();
              if (e.key === "Escape") cancel();
            }}
          />
        ) : (
          <span className={s.value}>{phone || <span className={s.muted}>없음</span>}</span>
        )}
      </div>
      {editing && !normalized && <p className={s.note}>010-1234-5678 처럼 번호를 끝까지 넣어야 저장할 수 있어요</p>}
      <div className={s.publicRow}>
        <span className={s.note}>{isPublic ? "같은 회사 사람 모두에게 보여요" : "나와 관리자만 볼 수 있어요"}</span>
        <span className={s.pair} role="radiogroup" aria-label="연락처 공개 여부">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={isPublic === v}
              className={`${s.chip} ${isPublic === v ? s.chipOn : ""}`}
              disabled={busy}
              onClick={() => void setPublic(v)}
            >
              {v ? "공개" : "비공개"}
            </button>
          ))}
        </span>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/** 소속 경로 "개발본부 › 프론트엔드팀". 회사(맨 위)는 빼고, 조직을 못 받으면 부서 글자 그대로 */
function OrgPath({ unitId, fallback }: { unitId: string | null; fallback: string | null }) {
  const units = useOrgUnits();
  const path = useMemo(() => {
    const byId = new Map(units.map((u) => [u.id, u]));
    const chain = unitChain(unitId, units)
      .map((id) => byId.get(id)!)
      .reverse();
    const shown = chain.length > 1 ? chain.filter((u) => u.parent_id) : chain;
    return shown.map((u) => u.name).join(" › ");
  }, [unitId, units]);
  return <>{path || fallback || "—"}</>;
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
