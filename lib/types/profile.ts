// ② 내 프로필 영역의 타입 (TECH_SPEC 4절 `profiles`·`profile_contacts`, 마이그레이션 20260930130000_my_profile.sql)

/** 본인이 고르는 상태. invisible = 접속해 있지만 남에게 오프라인으로 보이기 */
export type Status = "online" | "away" | "dnd" | "invisible";

/** 화면에 그리는 상태. 남은 접속자 채널에 없으면 offline (invisible 도 남에게는 offline) */
export type DisplayStatus = Status | "offline";

/** avatar 칸: null = 이름 첫 글자, "char:<캐릭터 id>" = 캐릭터, "photo:<내 id>/<파일>" = 올린 사진 */
export type AvatarValue = string | null;

export type MyProfile = {
  id: string;
  handle: string;
  display_name: string;
  department: string | null;
  title: string | null;
  org_unit_id: string | null;
  avatar: AvatarValue;
  status: Status;
  status_message: string;
  /** 로그인 메일 (auth.users) */
  email: string | null;
};

export type Contact = { phone: string; is_public: boolean };
