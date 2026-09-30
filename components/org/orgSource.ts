// ③ 조직도 데이터 (Supabase `org_units`·`profiles`). 로그인한 사람이면 모두 읽는다 (TECH_SPEC 5절).
// 사내 조직과 인원은 많지 않으므로 한 번에 받아 두고 브라우저에서 나무 모양으로 묶는다.
// 2026-09-30 오른쪽 패널에서 조직도 페이지(/org)로 옮겼다.

import type { OrgMember, OrgUnit } from "@/lib/types/org";
import { RANK_ORDER } from "@/lib/types/org";
import { getSupabase } from "@/lib/supabase";

export type OrgData = {
  units: Map<string, OrgUnit>;
  /** 조직 id → 바로 아래 조직 (sort_order 순) */
  children: Map<string, OrgUnit[]>;
  /** 조직 id → 그 조직에 바로 속한 사람 (장 먼저, 그다음 직급·이름 순) */
  members: Map<string, OrgMember[]>;
  root: OrgUnit | null;
};

const CACHE_MS = 60_000;
let cache: { at: number; data: Promise<OrgData> } | null = null;

export function loadOrg(): Promise<OrgData> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const data = fetchOrg();
    cache = { at: Date.now(), data };
    data.catch(() => {
      if (cache?.data === data) cache = null;
    });
  }
  return cache.data;
}

const rank = (title: string | null) => {
  const i = RANK_ORDER.indexOf(title ?? "");
  return i < 0 ? RANK_ORDER.length : i;
};

async function fetchOrg(): Promise<OrgData> {
  const sb = getSupabase();
  const [u, p] = await Promise.all([
    sb.from("org_units").select("id, name, kind, parent_id, leader_id, channel_id, sort_order").order("sort_order"),
    sb
      .from("profiles")
      .select("id, handle, display_name, department, title, org_unit_id")
      .not("org_unit_id", "is", null)
      .limit(1000),
  ]);
  if (u.error) throw new Error(u.error.message);
  if (p.error) throw new Error(p.error.message);

  const list = (u.data ?? []) as OrgUnit[];
  const units = new Map(list.map((x) => [x.id, x]));
  const children = new Map<string, OrgUnit[]>();
  for (const x of list) {
    if (!x.parent_id) continue;
    children.set(x.parent_id, [...(children.get(x.parent_id) ?? []), x]);
  }
  const members = new Map<string, OrgMember[]>();
  for (const m of (p.data ?? []) as OrgMember[]) {
    members.set(m.org_unit_id, [...(members.get(m.org_unit_id) ?? []), m]);
  }
  for (const [unitId, people] of members) {
    const leader = units.get(unitId)?.leader_id;
    people.sort(
      (a, b) =>
        Number(b.id === leader) - Number(a.id === leader) ||
        rank(a.title) - rank(b.title) ||
        a.display_name.localeCompare(b.display_name, "ko"),
    );
  }
  return { units, children, members, root: list.find((x) => !x.parent_id) ?? null };
}

/** 맨 위(회사)부터 이 조직까지 */
export function pathTo(org: OrgData, unitId: string): OrgUnit[] {
  const path: OrgUnit[] = [];
  for (let u = org.units.get(unitId); u; u = u.parent_id ? org.units.get(u.parent_id) : undefined) {
    path.unshift(u);
  }
  return path;
}

/** 이 조직과 모든 하위 조직의 인원 수 */
export function headcount(org: OrgData, unitId: string): number {
  return (
    (org.members.get(unitId)?.length ?? 0) +
    (org.children.get(unitId) ?? []).reduce((n, c) => n + headcount(org, c.id), 0)
  );
}

/** 조직의 장 (없으면 null) */
export function leaderOf(org: OrgData, unit: OrgUnit): OrgMember | null {
  if (!unit.leader_id) return null;
  return org.members.get(unit.id)?.find((m) => m.id === unit.leader_id) ?? null;
}
