// ② 조직도 조회 (Supabase `profiles`). DM·캘린더·채널 정보가 이 함수로 사람을 찾는다.
// 멘션을 "@이름" 으로 보여 줄 이름표(getMentionLabels·useMentionLabels)도 여기서 만든다 (① 채팅·③ 알림·② 검색이 같이 쓴다).
// profiles 는 로그인한 사람이면 모두 읽을 수 있다 (TECH_SPEC 5절).

import { useSyncExternalStore } from "react";
import type { Person } from "@/lib/types/people";
import { mentionLabels } from "@/lib/mentions";
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

/** 멘션 표시용 handle(소문자) → 이름 (회사 전체, lib/mentions). 채널을 나간 사람을 부른 멘션도 이름으로 보인다 */
export async function getMentionLabels(): Promise<Map<string, string>> {
  return mentionLabels(await directory());
}

// 화면 전체가 이름표 하나를 나눠 쓴다 (메시지마다 따로 받지 않는다). 명단 캐시와 같은 주기로 새로 받는다
const EMPTY: ReadonlyMap<string, string> = new Map();
let labelsNow: ReadonlyMap<string, string> = EMPTY;
let labelsAt = 0;
const labelListeners = new Set<() => void>();

function refreshLabels() {
  if (Date.now() - labelsAt < CACHE_MS) return;
  labelsAt = Date.now();
  getMentionLabels().then(
    (m) => {
      labelsNow = m;
      labelListeners.forEach((fn) => fn());
    },
    () => {
      labelsAt = 0; // 실패하면 다음에 다시
    },
  );
}

function subscribeLabels(fn: () => void) {
  labelListeners.add(fn);
  refreshLabels();
  return () => void labelListeners.delete(fn);
}

/** getMentionLabels 의 React 판. 명단을 받기 전에는 빈 Map (그동안은 저장된 글자 그대로 보인다) */
export function useMentionLabels(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribeLabels, () => labelsNow, () => EMPTY);
}

export function unknownPerson(id: string): Person {
  return { id, handle: id, display_name: "알 수 없는 사람", department: null, title: null };
}
