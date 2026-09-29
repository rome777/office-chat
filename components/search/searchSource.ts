// ② 메시지 검색 (F4-2). 화면(SearchBox)은 이 파일의 함수만 부른다.
//
// messages.body 의 pg_trgm 인덱스로 부분 일치(ilike)를 찾는다 — 한국어는 Postgres 기본 전문 검색이 약해서 쓰지 않는다.
// 사용자 토큰으로 조회하므로 RLS 가 **내가 멤버인 채널·DM 의 메시지만** 돌려준다 (비회원에게는 0건).
// 지운 메시지는 뺀다. 답글도 찾는다 (누르면 ① 이 스레드를 열어 준다).
// 멘션은 본문에 "@아이디" 로 저장되고 화면에는 "@이름" 으로 보인다 (lib/mentions) → 이름으로 찾으면 그 사람을 부른 메시지도 찾고,
// 결과가 검색어를 담고 있는지는 화면에 보이는 글(이름으로 바꾼 본문)로 거른다.

import { showMentions } from "@/lib/mentions";
import { getSupabase } from "@/lib/supabase";

export const MIN_QUERY = 2;
export const MAX_RESULTS = 30;
/** * 가 든 검색어는 넓게 받아 거르므로 더 많이 받는다 (30건만 받아 거르면 맞는 결과가 빠진다) */
const WIDE_FETCH = 200;
/** 이름으로 찾을 때 함께 찾는 사람 수 (그 사람들의 "@아이디") */
const MENTION_PEOPLE = 5;

export type SearchHit = {
  id: number;
  channel_id: string;
  parent_id: number | null;
  user_id: string | null;
  /** Step 1 익명 메시지의 닉네임 */
  author: string | null;
  body: string;
  created_at: string;
};

export type SearchResult = { hits: SearchHit[]; elapsedMs: number };

/** 비교용: 한글 조합 방식 통일, 대소문자 무시 */
export const normalize = (s: string) => s.normalize("NFC").toLowerCase();

/** ilike 의 % _ \ 는 글자 그대로 찾게 막는다 */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * PostgREST 는 like 패턴의 * 를 % 로 바꾸고 막을 방법이 없다. 그래서 * 가 든 검색어는
 * * 로 나눈 가장 긴 조각으로 DB 에서 넓게 찾고, 받아 온 뒤 검색어 전체가 들어 있는지 다시 거른다.
 */
function serverPiece(query: string): string {
  return query
    .split("*")
    .map((p) => p.trim())
    .sort((a, b) => b.length - a.length)[0];
}

const base = () => getSupabase().from("messages").select("id, channel_id, parent_id, user_id, author, body, created_at");

export async function searchMessages(
  rawQuery: string,
  options: { channelId?: string; labels?: ReadonlyMap<string, string> } = {},
): Promise<SearchResult> {
  const labels = options.labels ?? new Map<string, string>();
  const query = rawQuery.normalize("NFC").trim();
  if ([...query].length < MIN_QUERY) return { hits: [], elapsedMs: 0 };
  const piece = serverPiece(query);
  // "**" 처럼 * 뿐이면 찾을 글자가 없다
  if (!piece) return { hits: [], elapsedMs: 0 };
  const wide = piece !== query;

  const needle = normalize(query);
  // 이름이 검색어를 담은 사람의 아이디 (handle 은 영문·숫자·_·-·한글뿐이라 or 필터에 그대로 넣어도 된다. _ 는 한 글자 와일드카드지만 아래에서 다시 거른다)
  const handles = wide ? [] : [...labels].filter(([, label]) => normalize(label).includes(needle)).slice(0, MENTION_PEOPLE).map(([h]) => h);

  const started = performance.now();
  const find = (apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    let request = apply(base()).is("deleted_at", null).order("id", { ascending: false }).limit(wide ? WIDE_FETCH : MAX_RESULTS);
    if (options.channelId) request = request.eq("channel_id", options.channelId);
    return request;
  };
  const [byText, byMention] = await Promise.all([
    find((q) => q.ilike("body", `%${escapeLike(piece)}%`)),
    handles.length ? find((q) => q.or(handles.map((h) => `body.ilike.*@${h}*`).join(","))) : Promise.resolve({ data: [], error: null }),
  ]);
  const elapsedMs = performance.now() - started;
  const error = byText.error ?? byMention.error;
  if (error) throw new Error(error.message);

  const merged = new Map<number, SearchHit>();
  for (const m of [...(byText.data ?? []), ...(byMention.data ?? [])] as SearchHit[]) merged.set(m.id, m);
  const hits = [...merged.values()]
    .filter((m) => normalize(showMentions(m.body, labels)).includes(needle)) // 숨은 아이디로는 걸리지 않게, 보이는 글로만
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_RESULTS);
  return { hits, elapsedMs };
}

/** 본문에서 검색어 주변만 잘라 [앞, 일치, 뒤] 로 돌려준다 (강조 표시용). 못 찾으면 앞부분만.
 *  찾는 문자열과 자르는 문자열을 같게 맞춘다 (NFC·공백 정리) — 다르면 강조가 밀린다 */
export function snippet(body: string, query: string, around = 30): [string, string, string] {
  const text = body.normalize("NFC").replace(/\s+/g, " ");
  const q = query.normalize("NFC").trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  // 소문자로 바꾸면 길이가 달라지는 글자(예: İ)가 있으면 위치를 믿을 수 없으니 강조 없이 앞부분만 보인다
  const at = lower.length === text.length ? lower.indexOf(q.toLowerCase()) : -1;
  if (at < 0 || !q) return [text.slice(0, around * 2), "", text.length > around * 2 ? "…" : ""];
  const end = at + q.length;
  const from = Math.max(0, at - around);
  const to = Math.min(text.length, end + around);
  return [
    (from > 0 ? "…" : "") + text.slice(from, at),
    text.slice(at, end),
    text.slice(end, to) + (to < text.length ? "…" : ""),
  ];
}
