// ② 조직도 조회 (Supabase `profiles`). DM·캘린더·채널 정보가 이 함수로 사람을 찾는다.
// profiles 는 로그인한 사람이면 모두 읽을 수 있다 (TECH_SPEC 5절).

import type { Person } from "@/lib/types/people";
import { getSupabase } from "@/lib/supabase";

export const MAX_RESULTS = 20;

const COLUMNS = "id, handle, display_name, department, title";

// 사내 인원은 많지 않으므로 명단을 한 번 받아 두고 브라우저에서 거른다.
// (PostgREST 의 or·ilike 는 쉼표·괄호·* 를 특수 문자로 봐서, 검색어를 안전하게 넣기 어렵다)
const CACHE_MS = 60_000;
let cache: { at: number; people: Promise<Person[]> } | null = null;

function directory(): Promise<Person[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const people = (async () => {
      const { data, error } = await getSupabase()
        .from("profiles")
        .select(COLUMNS)
        .order("display_name")
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Person[];
    })();
    cache = { at: Date.now(), people };
    // 실패한 요청은 기억하지 않는다 (다음 검색 때 다시 시도)
    people.catch(() => {
      if (cache?.people === people) cache = null;
    });
  }
  return cache.people;
}

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFC").toLowerCase();

/** 이름·부서·직함·핸들의 일부로 찾는다 (한글 부분 단어, 대소문자 무시) */
export async function searchPeople(query: string): Promise<Person[]> {
  const q = norm(query.trim());
  if (!q) return [];
  const people = await directory();
  return people
    .filter((p) => [p.display_name, p.department, p.title, p.handle].some((v) => norm(v).includes(q)))
    .slice(0, MAX_RESULTS);
}

/** id 로 여러 사람을 한 번에 가져온다 (참석자 목록 표시용). 명단에 없는 id 도 빠뜨리지 않고
 *  "알 수 없는 사람"으로 돌려준다 — 빠뜨리면 회의를 고칠 때 그 참석자가 조용히 지워진다 */
export async function getPeople(ids: string[]): Promise<Person[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { data, error } = await getSupabase().from("profiles").select(COLUMNS).in("id", unique);
  if (error) throw new Error(error.message);
  const byId = new Map(((data ?? []) as Person[]).map((p) => [p.id, p]));
  return unique.map((id) => byId.get(id) ?? unknownPerson(id));
}

export function unknownPerson(id: string): Person {
  return { id, handle: id, display_name: "알 수 없는 사람", department: null, title: null };
}
