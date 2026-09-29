// ② 사람 찾기(조직도) 영역의 타입 (TECH_SPEC 4절 `profiles`)

export type Person = {
  id: string;
  handle: string;
  display_name: string;
  department: string | null;
  title: string | null;
};
