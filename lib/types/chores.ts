// ③ 잡무 수첩의 타입 (TECH_SPEC 4절 `chore_lists`·`chore_entries`)

/** 사람별 기록 한 줄. 예: 이부장님 — 아아 얼음 많이 */
export type ChoreEntry = {
  id: string;
  list_id: string;
  person_name: string;
  detail: string;
  created_at: string;
};

/** 잡무 목록 하나. 예: 커피 — 1층 스타벅스, 법인카드 */
export type ChoreList = {
  id: string;
  channel_id: string;
  title: string;
  place: string;
  memo: string;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  chore_entries: ChoreEntry[];
};
