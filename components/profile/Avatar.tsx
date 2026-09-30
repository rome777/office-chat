"use client";

// ② 프로필 사진 동그라미 — 올린 사진, 캐릭터, 없으면 이름 첫 글자. status 를 주면 오른쪽 아래에 상태 점을 그린다.

import type { AvatarValue, Status } from "@/lib/types/profile";
import { CharacterArt, findCharacter } from "./characters";
import { avatarPhotoUrl, STATUS_LABEL } from "./profileSource";
import s from "./profile.module.css";

export default function Avatar({
  name,
  avatar,
  size,
  status,
}: {
  name: string;
  avatar: AvatarValue;
  size: number;
  status?: Status;
}) {
  const photo = avatarPhotoUrl(avatar);
  // 모르는 캐릭터 id(다른 버전에서 고른 것 등)면 이름 첫 글자로
  const character = avatar?.startsWith("char:") && findCharacter(avatar.slice(5)) ? avatar.slice(5) : null;
  return (
    <span className={s.avatar} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {photo ? (
        // 보관함의 공개 주소를 그대로 쓴다 (next/image 는 외부 주소 설정이 필요해 쓰지 않는다)
        <img src={photo} alt="" width={size} height={size} className={s.avatarImg} />
      ) : character ? (
        <CharacterArt id={character} size={size} />
      ) : (
        <span aria-hidden="true">{name.slice(0, 1)}</span>
      )}
      {status && (
        <span
          className={`${s.dot} ${s[status]}`}
          style={{ width: Math.max(8, Math.round(size * 0.26)), height: Math.max(8, Math.round(size * 0.26)) }}
          title={STATUS_LABEL[status]}
        />
      )}
    </span>
  );
}
