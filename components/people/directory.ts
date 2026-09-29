// ② 조직도 조회. DM·캘린더·채널 정보가 이 함수로 사람을 찾는다.
// 지금은 가짜 명단이다. WU-02 로 `profiles` 테이블이 생기면 searchPeople 안만 Supabase 조회로 바꾼다
// (부르는 쪽은 그대로). 실명·실제 사내 정보는 넣지 않는다.

import type { Person } from "@/lib/types/people";

/** 가짜 명단에서 "나"로 쓰는 사람. 로그인이 붙으면 로그인한 사용자의 id 로 바뀐다 */
export const DEMO_ME_ID = "demo-b";

const DEMO_PEOPLE: Person[] = [
  { id: "demo-a", handle: "user_a", display_name: "사용자 A", department: "제품팀", title: "매니저" },
  { id: "demo-b", handle: "user_b", display_name: "사용자 B", department: "개발팀", title: "엔지니어" },
  { id: "demo-c", handle: "user_c", display_name: "사용자 C", department: "영업팀", title: "사원" },
  { id: "demo-admin", handle: "admin", display_name: "관리자", department: "경영지원팀", title: "팀장" },
  { id: "demo-d", handle: "designer_kim", display_name: "김디자인", department: "디자인팀", title: "디자이너" },
  { id: "demo-e", handle: "dev_lee", display_name: "이개발", department: "개발팀", title: "선임" },
  { id: "demo-f", handle: "pm_park", display_name: "박기획", department: "제품팀", title: "PM" },
];

export const MAX_RESULTS = 20;

/** 이름·부서·직함·핸들의 일부로 찾는다 (한글 부분 단어, 대소문자 무시) */
export async function searchPeople(query: string): Promise<Person[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return DEMO_PEOPLE.filter((p) =>
    [p.display_name, p.department, p.title, p.handle].some((v) => v?.toLowerCase().includes(q)),
  ).slice(0, MAX_RESULTS);
}

/** id 로 여러 사람을 한 번에 가져온다 (참석자 목록 표시용). 명단에 없는 id 도 빠뜨리지 않고
 *  "알 수 없는 사람"으로 돌려준다 — 빠뜨리면 회의를 고칠 때 그 참석자가 조용히 지워진다 */
export async function getPeople(ids: string[]): Promise<Person[]> {
  const byId = new Map(DEMO_PEOPLE.map((p) => [p.id, p]));
  return [...new Set(ids)].map((id) => byId.get(id) ?? unknownPerson(id));
}

export function unknownPerson(id: string): Person {
  return { id, handle: id, display_name: "알 수 없는 사람", department: null, title: null };
}
