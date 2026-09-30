"use client";

// ② 오른쪽 패널의 "내 프로필". 헤더의 내 이름 메뉴(UserMenu)에서 연다.
// 저장 방식이 부분마다 다르다: 상태는 누르면 바로, 상태 메시지는 Enter·칸을 떠날 때, 연락처는 [연락처 저장]. 기본 정보는 고칠 수 없다.

import { useMemo, useState } from "react";
import type { Status } from "@/lib/types/profile";
import { unitChain } from "@/lib/mentions";
import { useOrgUnits } from "@/components/people/directory";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import Avatar from "./Avatar";
import AvatarDialog from "./AvatarDialog";
import PasswordDialog from "./PasswordDialog";
import {
  PHONE_PATTERN,
  STATUS_LABEL,
  STATUS_MESSAGE_MAX,
  saveContact,
  updateMyProfile,
  useMyProfile,
} from "./profileSource";
import s from "./profile.module.css";

const PANEL_STATUSES: Status[] = ["online", "away", "dnd"];

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
        <div className={s.topText}>
          <strong className={s.topName}>{profile.display_name}</strong>
          <span className="muted">{[profile.department, profile.title].filter(Boolean).join(" · ") || "소속 없음"}</span>
          <button type="button" className={s.button} onClick={() => setDialog("avatar")}>
            <CameraIcon /> 사진 바꾸기
          </button>
        </div>
      </section>

      <StatusSection status={profile.status} message={profile.status_message} />

      <section className={s.section} aria-labelledby="profile-basic">
        <div className={s.sectionHead}>
          <h3 id="profile-basic">기본 정보</h3>
          <span className={s.tag}>
            <LockIcon /> 인사 정보
          </span>
        </div>
        <dl className={s.info}>
          <dt>이름</dt>
          <dd>{profile.display_name}</dd>
          <dt>부서</dt>
          <dd>
            <OrgPath unitId={profile.org_unit_id} fallback={profile.department} />
          </dd>
          <dt>직급</dt>
          <dd>{profile.title ?? "—"}</dd>
          <dt>이메일</dt>
          <dd>{profile.email ?? "—"}</dd>
        </dl>
        <p className={s.note}>바꿀 곳이 있으면 인사팀에 요청하세요</p>
      </section>

      <ContactSection phone={contact.phone} isPublic={contact.is_public} />

      <section className={s.section} aria-labelledby="profile-account">
        <div className={s.sectionHead}>
          <h3 id="profile-account">계정 관리</h3>
        </div>
        <div className={s.row}>
          <span>비밀번호</span>
          <button type="button" className={s.button} onClick={() => setDialog("password")}>
            바꾸기
          </button>
        </div>
        <div className={s.row}>
          <span>로그아웃</span>
          <button type="button" className={s.button} onClick={signOut}>
            로그아웃
          </button>
        </div>
      </section>

      {dialog === "avatar" && <AvatarDialog me={profile} onClose={() => setDialog(null)} />}
      {dialog === "password" && <PasswordDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function StatusSection({ status, message }: { status: Status; message: string }) {
  const [draft, setDraft] = useState(message);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState(message);
  // 저장한 값(또는 실패해서 되돌아간 값)이 바뀌면 입력칸도 따라간다
  if (message !== lastMessage) {
    setLastMessage(message);
    setDraft(message);
  }

  async function run(patch: Parameters<typeof updateMyProfile>[0], done: string) {
    setError(null);
    try {
      await updateMyProfile(patch);
      setSaved(done);
      setTimeout(() => setSaved((v) => (v === done ? null : v)), 1500);
    } catch (e) {
      setError(`저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const saveMessage = () => {
    const next = draft.trim();
    if (next === message) return;
    void run({ status_message: next }, next ? "상태 메시지 저장됨" : "상태 메시지 지움");
  };

  return (
    <section className={s.section} aria-labelledby="profile-status">
      <div className={s.sectionHead}>
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
            onClick={() => status !== st && void run({ status: st }, `${STATUS_LABEL[st]}(으)로 바꿈`)}
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
      <label className={s.label} htmlFor="profile-status-message">
        상태 메시지
      </label>
      <input
        id="profile-status-message"
        className={s.input}
        value={draft}
        maxLength={STATUS_MESSAGE_MAX}
        placeholder="외근 중 · 15시 복귀"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return; // 한글 조합 중 Enter (TECH_SPEC 13절)
          if (e.key === "Enter") saveMessage();
          if (e.key === "Escape") setDraft(message);
        }}
        onBlur={saveMessage}
      />
      <p className={s.note} aria-live="polite">
        {error ? <span className="error-text">{error}</span> : (saved ?? "Enter 로 저장 · 비우면 지워짐")}
      </p>
    </section>
  );
}

function ContactSection({ phone, isPublic }: { phone: string; isPublic: boolean }) {
  const [draft, setDraft] = useState(phone);
  const [pub, setPub] = useState(isPublic);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = PHONE_PATTERN.test(draft.trim());
  const changed = draft.trim() !== phone || pub !== isPublic;

  async function save() {
    if (!valid) return setMsg({ ok: false, text: "숫자·-·+·괄호·공백만 20자까지 쓸 수 있습니다" });
    setBusy(true);
    setMsg(null);
    try {
      await saveContact({ phone: draft.trim(), is_public: pub });
      setMsg({ ok: true, text: "저장됨" });
    } catch (e) {
      setMsg({ ok: false, text: `저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.section} aria-labelledby="profile-contact">
      <div className={s.sectionHead}>
        <h3 id="profile-contact">연락처</h3>
      </div>
      <input
        className={s.input}
        type="tel"
        inputMode="tel"
        value={draft}
        placeholder="010-1234-5678"
        aria-label="연락처"
        aria-invalid={!valid}
        onChange={(e) => {
          setDraft(e.target.value);
          setMsg(null);
        }}
      />
      <div className={s.row}>
        <span className="muted">공개 여부</span>
        <span className={s.pair} role="radiogroup" aria-label="연락처 공개 여부">
          {[true, false].map((v) => (
            <button key={String(v)} type="button" role="radio" aria-checked={pub === v} className={`${s.chip} ${pub === v ? s.chipOn : ""}`} onClick={() => setPub(v)}>
              {v ? "공개" : "비공개"}
            </button>
          ))}
        </span>
      </div>
      <p className={`${s.note} ${s.right}`}>{pub ? "같은 회사 사람 모두에게 보여요" : "나와 관리자만 볼 수 있어요"}</p>
      <div className={s.saveRow}>
        {msg && <span className={msg.ok ? s.note : "error-text"}>{msg.text}</span>}
        <button type="button" className={`${s.button} ${s.primary}`} onClick={save} disabled={busy || !changed}>
          {busy ? "저장 중…" : "연락처 저장"}
        </button>
      </div>
    </section>
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
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
