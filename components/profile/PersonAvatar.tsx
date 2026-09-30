"use client";

// ② 사람 id 로 그리는 프로필 사진 + 상태 점. 채팅(①)·조직도(③)가 가져다 쓴다.
// 사진·상태 메시지는 명단(directory, 1분마다 새로), 상태는 접속자 채널(presence)에서 온다.
// 나는 내 프로필 창구의 값을 바로 쓴다 (바꾸자마자 보이게, "오프라인으로 표시"도 나에게는 그대로 보이게).

import { usePeopleLooks } from "@/components/people/directory";
import Avatar from "./Avatar";
import { usePresenceStatus } from "./presence";
import { useMyProfile } from "./profileSource";

export default function PersonAvatar({
  userId,
  name,
  size,
}: {
  /** null 이면 로그인 전 메시지(Step 1 닉네임) — 이름 글자만, 상태 점 없음 */
  userId: string | null;
  name: string;
  size: number;
}) {
  const { profile } = useMyProfile();
  const looks = usePeopleLooks();
  const presence = usePresenceStatus(userId ?? "");

  if (!userId) return <Avatar name={name} avatar={null} size={size} />;
  if (profile && profile.id === userId) {
    return <Avatar name={name} avatar={profile.avatar} size={size} status={profile.status} message={profile.status_message} />;
  }
  const look = looks.get(userId);
  return (
    <Avatar
      name={name}
      avatar={look?.avatar ?? null}
      size={size}
      status={presence}
      message={presence === "offline" ? undefined : look?.status_message}
    />
  );
}
