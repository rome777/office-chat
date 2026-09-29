// ③ 조직도 패널의 타입 (TECH_SPEC 4절 `org_units`, `profiles.org_unit_id`)

import type { Person } from "./people";

/** 회사·사업부·본부·팀 */
export type OrgKind = "company" | "division" | "hq" | "team";

export type OrgUnit = {
  id: string;
  name: string;
  kind: OrgKind;
  parent_id: string | null;
  leader_id: string | null;
  /** 이 조직의 대화방. 회사는 #일반 */
  channel_id: string;
  sort_order: number;
};

/** 조직도에 보이는 사람 (소속이 있는 사람만) */
export type OrgMember = Person & { org_unit_id: string };

export const KIND_LABEL: Record<OrgKind, string> = {
  company: "회사",
  division: "사업부",
  hq: "본부",
  team: "팀",
};

/** 조직의 장을 부르는 이름 (직책) */
export const LEADER_LABEL: Record<OrgKind, string> = {
  company: "대표",
  division: "사업부장",
  hq: "본부장",
  team: "팀장",
};

/** 직급 순서 (높은 쪽이 앞). 목록에 없는 직급은 맨 뒤 */
export const RANK_ORDER = ["대표이사", "부사장", "전무", "상무", "이사", "부장", "차장", "과장", "대리", "주임", "사원"];
