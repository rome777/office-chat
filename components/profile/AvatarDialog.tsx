"use client";

// ② 프로필 사진 바꾸기 — 사진 올리기(브라우저에서 256px 정사각형으로 잘라 올린다) 또는 캐릭터 고르기.
// 적용을 눌러야 바뀐다. 사진은 가운데를 기준으로 정사각형으로 자른다.

import { useEffect, useRef, useState } from "react";
import type { MyProfile } from "@/lib/types/profile";
import Modal from "@/components/sidebar/Modal";
import ui from "@/components/sidebar/sidebar.module.css";
import Avatar from "./Avatar";
import { CHARACTERS, CharacterArt } from "./characters";
import { chooseCharacter, uploadMyPhoto } from "./profileSource";
import s from "./profile.module.css";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_SOURCE = 10 * 1024 * 1024; // 고르는 원본 상한. 올리는 것은 잘라서 줄인 사진이다
const SIDE = 256;

type Pick =
  | { kind: "character"; id: string }
  | { kind: "photo"; blob: Blob; ext: "webp" | "jpg"; url: string };

export default function AvatarDialog({ me, onClose }: { me: MyProfile; onClose: () => void }) {
  const current = me.avatar?.startsWith("char:") ? me.avatar.slice(5) : null;
  const [tab, setTab] = useState<"photo" | "character">(me.avatar?.startsWith("photo:") ? "photo" : "character");
  const [pick, setPick] = useState<Pick | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // 사진을 자르는 동안 다른 사진을 고르거나 창을 닫으면, 늦게 끝난 앞의 결과는 버린다
  const latest = useRef(0);
  useEffect(() => () => void (latest.current = -1), []);

  // 미리보기 주소는 다 쓰면 돌려준다
  const photoUrl = pick?.kind === "photo" ? pick.url : null;
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  async function takeFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!ACCEPT.includes(file.type)) return setError("JPG·PNG·WEBP 사진만 쓸 수 있습니다");
    if (file.size > MAX_SOURCE) return setError("10MB 이하 사진을 고르세요");
    const turn = ++latest.current;
    try {
      const { blob, ext } = await cropSquare(file);
      if (turn !== latest.current) return;
      setPick({ kind: "photo", blob, ext, url: URL.createObjectURL(blob) });
    } catch {
      if (turn === latest.current) setError("사진을 읽지 못했습니다. 다른 사진을 고르세요");
    }
  }

  async function apply() {
    if (!pick) return onClose();
    setBusy(true);
    setError(null);
    try {
      if (pick.kind === "photo") await uploadMyPhoto(pick.blob, pick.ext);
      else await chooseCharacter(pick.id);
      onClose();
    } catch (e) {
      setError(`바꾸지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  const previewAvatar =
    pick?.kind === "character" ? `char:${pick.id}` : pick?.kind === "photo" ? null : me.avatar;

  return (
    <Modal onClose={onClose}>
      <div className={ui.dialog} role="dialog" aria-modal="true" aria-labelledby="avatar-dialog-title">
        <h2 id="avatar-dialog-title">프로필 사진 바꾸기</h2>

        <div className={s.tabs} role="tablist" aria-label="사진 종류">
          <button type="button" role="tab" aria-selected={tab === "photo"} className={`${s.chip} ${tab === "photo" ? s.chipOn : ""}`} onClick={() => setTab("photo")}>
            사진 올리기
          </button>
          <button type="button" role="tab" aria-selected={tab === "character"} className={`${s.chip} ${tab === "character" ? s.chipOn : ""}`} onClick={() => setTab("character")}>
            캐릭터 고르기
          </button>
        </div>

        {tab === "photo" ? (
          <button
            type="button"
            className={`${s.drop} ${dragging ? s.dropOver : ""}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void takeFile(e.dataTransfer.files[0]);
            }}
          >
            <UploadIcon />
            <span>이미지를 끌어다 놓거나 눌러서 고르기</span>
            <span className={s.note}>JPG·PNG·WEBP · 가운데를 정사각형으로 잘라 저장</span>
          </button>
        ) : (
          <div className={s.characterGrid} role="radiogroup" aria-label="캐릭터">
            {CHARACTERS.map((c) => {
              const on = pick?.kind === "character" ? pick.id === c.id : !pick && current === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={c.name}
                  title={c.name}
                  className={`${s.character} ${on ? s.characterOn : ""}`}
                  onClick={() => setPick({ kind: "character", id: c.id })}
                >
                  <CharacterArt id={c.id} size={44} />
                </button>
              );
            })}
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT.join(",")}
          hidden
          onChange={(e) => {
            void takeFile(e.target.files?.[0]);
            e.target.value = ""; // 같은 파일을 다시 골라도 바뀌게
          }}
        />

        {error && <p className="error-text">{error}</p>}

        <div className={s.dialogFoot}>
          <span className={s.preview}>
            {photoUrl ? (
              // 방금 자른 사진 (아직 올리기 전이라 blob 주소)
              <img src={photoUrl} alt="" width={40} height={40} className={s.previewImg} />
            ) : (
              <Avatar name={me.display_name} avatar={previewAvatar} size={40} />
            )}
            <span className={s.note}>미리보기</span>
          </span>
          <span className={ui.actions}>
            <button type="button" className={ui.secondary} onClick={onClose}>
              취소
            </button>
            <button type="button" className={ui.primary} onClick={apply} disabled={busy || !pick}>
              {busy ? "적용 중…" : "적용"}
            </button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

/** 가운데를 정사각형으로 잘라 256px 로 줄인다. WEBP 로 못 만드는 브라우저(사파리 일부)는 JPEG 로 */
async function cropSquare(file: File): Promise<{ blob: Blob; ext: "webp" | "jpg" }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#ffffff"; // 투명한 PNG 를 JPEG 로 만들 때 검게 되지 않게
  ctx.fillRect(0, 0, SIDE, SIDE);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.85));
  const webp = await toBlob("image/webp");
  if (webp?.type === "image/webp") return { blob: webp, ext: "webp" };
  const jpeg = await toBlob("image/jpeg");
  if (!jpeg) throw new Error("toBlob");
  return { blob: jpeg, ext: "jpg" };
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}
