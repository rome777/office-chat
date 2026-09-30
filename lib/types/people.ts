// ② 사람 찾기(조직도) 영역의 타입 (TECH_SPEC 4절 `profiles`)

export type Person = {
  id: string;
  handle: string;
  display_name: string;
  department: string | null;
  title: string | null;
  /** 프로필 사진 (lib/types/profile AvatarValue). 명단(directory)에만 들어 있다 */
  avatar?: string | null;
  status_message?: string;
};
