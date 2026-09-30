"use client";

// ② 오른쪽 패널의 "내 프로필" (2026-09-30 개편, 로그인한 사람 기준). 왼쪽 메뉴의 "설정"·내 카드, 헤더의 내 메뉴, 내 프로필 카드에서 연다.
// 1. 현재 상태(수정 가능) 2. 기본 정보(수정 불가 — 인사 정보) 3. 연락처 4. 계정 관리.
// 상태·상태 메시지·연락처는 아래 [변경사항 저장] 한 번에 저장한다. 사진은 창에서 고르는 즉시 바뀐다.

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
import s from "./myProfile.module.css";

const STATUSES: Status[] = ["online", "away", "dnd", "invisible"];

export default function ProfilePanel() {
  const { profile, contact, error } = useMyProfile();
  if (error) return <p className="error-text">{error}</p>;
  if (!profile || !contact) return <p className="muted">불러오는 중…</p>;
  // 입력칸은 패널을 열 때의 값에서 시작한다 (다른 탭에서 계정이 바뀌면 새로)
  return <Form key={profile.id} />;
}

function Form() {
  const { profile, contact } = useMyProfile();
  const { signOut } = useWorkspace();
  const [dialog, setDialog] = useState<"photo" | "character" | "password" | null>(null);
  const [status, setStatus] = useState<Status>(profile!.status);
  const [message, setMessage] = useState(profile!.status_message);
  const [phone, setPhone] = useState(contact!.phone);
  const [isPublic, setIsPublic] = useState(contact!.is_public);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const me = profile!;
  const saved = contact!;

  const phoneValid = PHONE_PATTERN.test(phone.trim());
  const statusChanged = status !== me.status || message.trim() !== me.status_message;
  const contactChanged = phone.trim() !== saved.phone || isPublic !== saved.is_public;
  const changed = statusChanged || contactChanged;

  async function save() {
    if (!phoneValid) return setResult({ ok: false, text: "연락처는 숫자·-·+·괄호·공백만 20자까지 쓸 수 있습니다" });
    setBusy(true);
    setResult(null);
    try {
      // 두 표가 달라서 따로 저장한다. 앞쪽이 실패하면 뒤쪽은 하지 않는다
      if (statusChanged) await updateMyProfile({ status, status_message: message.trim() });
      if (contactChanged) await saveContact({ phone: phone.trim(), is_public: isPublic });
      setResult({ ok: true, text: "저장했습니다" });
    } catch (e) {
      setResult({ ok: false, text: `저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.panel}>
      <div className={s.scroll}>
        <section className={s.top}>
          <Avatar name={me.display_name} avatar={me.avatar} size={72} status={me.status} />
          <div className={s.topText}>
            <div className={s.topRow}>
              <strong className={s.topName}>{me.display_name}</strong>
              <span className={`${s.tag} ${s.tagOk}`}>프로필 설정</span>
            </div>
            <span className={s.muted}>{[me.department, me.title].filter(Boolean).join(" · ") || "소속 없음"}</span>
            <span className={s.topButtons}>
              <button type="button" className={s.pill} onClick={() => setDialog("photo")}>
                사진 추가
              </button>
              <button type="button" className={s.pill} onClick={() => setDialog("character")}>
                아바타 변경
              </button>
            </span>
          </div>
        </section>

        <section className={s.section} aria-labelledby="profile-status">
          <div className={s.head}>
            <h3 id="profile-status">1. 현재 상태</h3>
            <span className={`${s.tag} ${s.tagOk}`}>수정 가능</span>
          </div>
          <div className={s.card}>
            <label className={s.label} htmlFor="profile-status-select">
              내 활동 상태
            </label>
            <span className={s.selectWrap}>
              <span className={`${s.dot} ${s[status]}`} aria-hidden="true" />
              <select id="profile-status-select" className={s.select} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                {STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {STATUS_LABEL[st]}
                  </option>
                ))}
              </select>
            </span>
            {status === "invisible" && <p className={s.note}>다른 사람에게는 오프라인으로 보입니다</p>}
            <label className={s.label} htmlFor="profile-status-message">
              상태 메시지
            </label>
            <textarea
              id="profile-status-message"
              className={s.input}
              rows={2}
              value={message}
              maxLength={STATUS_MESSAGE_MAX}
              placeholder="현재 나의 상태를 알려주세요."
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className={`${s.note} ${s.right}`}>
              {[...message].length}/{STATUS_MESSAGE_MAX}
            </p>
          </div>
        </section>

        <section className={s.section} aria-labelledby="profile-basic">
          <div className={s.head}>
            <h3 id="profile-basic">2. 기본 정보</h3>
            <span className={s.tag}>수정 불가</span>
          </div>
          <Field label="아이디" value={me.handle} />
          <Field label="이름" value={me.display_name} />
          <OrgPathField unitId={me.org_unit_id} fallback={me.department} />
          <Field label="직급" value={me.title ?? "—"} />
          <Field label="이메일" value={me.email ?? "—"} />
          <p className={s.note}>바꿀 곳이 있으면 인사팀에 요청하세요</p>
        </section>

        <section className={s.section} aria-labelledby="profile-contact">
          <div className={s.head}>
            <h3 id="profile-contact">3. 연락처</h3>
          </div>
          <input
            className={s.input}
            type="tel"
            inputMode="tel"
            value={phone}
            placeholder="연락처 입력"
            aria-label="연락처"
            aria-invalid={!phoneValid}
            onChange={(e) => setPhone(e.target.value)}
          />
          <div className={s.row}>
            <span className={s.strong}>연락처 공개</span>
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              className={`${s.tag} ${isPublic ? s.tagOk : ""} ${s.switch}`}
              onClick={() => setIsPublic((v) => !v)}
            >
              {isPublic ? "공개" : "비공개"}
            </button>
          </div>
          <p className={s.note}>{isPublic ? "같은 회사 사람 모두에게 보여요" : "나와 관리자만 볼 수 있어요"}</p>
        </section>

        <section className={s.section} aria-labelledby="profile-account">
          <div className={s.head}>
            <h3 id="profile-account">4. 계정 관리</h3>
          </div>
          <div className={s.row}>
            <span className={s.strong}>비밀번호 변경</span>
            <button type="button" className={s.pill} onClick={() => setDialog("password")}>
              변경하기
            </button>
          </div>
          <div className={s.row}>
            <span className={s.strong}>로그아웃</span>
            <button type="button" className={s.pill} onClick={signOut}>
              로그아웃
            </button>
          </div>
        </section>
      </div>

      <footer className={s.footer}>
        {result && (
          <p className={result.ok ? s.note : "error-text"} role="status">
            {result.text}
          </p>
        )}
        <button type="button" className={s.save} onClick={() => void save()} disabled={busy || !changed}>
          {busy ? "저장 중…" : "변경사항 저장"}
        </button>
      </footer>

      {(dialog === "photo" || dialog === "character") && <AvatarDialog me={me} initialTab={dialog} onClose={() => setDialog(null)} />}
      {dialog === "password" && <PasswordDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      <input className={s.input} value={value} readOnly disabled />
    </label>
  );
}

/** 소속 경로 "개발본부 › 프론트엔드팀". 회사(맨 위)는 빼고, 조직을 못 받으면 부서 글자 그대로 */
function OrgPathField({ unitId, fallback }: { unitId: string | null; fallback: string | null }) {
  const units = useOrgUnits();
  const path = useMemo(() => {
    const byId = new Map(units.map((u) => [u.id, u]));
    const chain = unitChain(unitId, units)
      .map((id) => byId.get(id)!)
      .reverse();
    const shown = chain.length > 1 ? chain.filter((u) => u.parent_id) : chain;
    return shown.map((u) => u.name).join(" › ");
  }, [unitId, units]);
  return <Field label="부서" value={path || fallback || "—"} />;
}
