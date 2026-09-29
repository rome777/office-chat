// ② 메시지 검색 (F4-2). 화면(SearchBox)은 이 파일의 함수만 부른다.
//
// messages.body 의 pg_trgm 인덱스로 부분 일치(ilike)를 찾는다 — 한국어는 Postgres 기본 전문 검색이 약해서 쓰지 않는다.
// 사용자 토큰으로 조회하므로 RLS 가 **내가 멤버인 채널·DM 의 메시지만** 돌려준다 (비회원에게는 0건).
// 지운 메시지는 뺀다. 답글도 찾는다 (누르면 ① 이 스레드를 열어 준다).

import { getSupabase } from "@/lib/supabase";

export const MIN_QUERY = 2;
export const MAX_RESULTS = 30;
/** * 가 든 검색어는 넓게 받아 거르므로 더 많이 받는다 (30건만 받아 거르면 맞는 결과가 빠진다) */
const WIDE_FETCH = 200;

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

export async function searchMessages(
  rawQuery: string,
  options: { channelId?: string } = {},
): Promise<SearchResult> {
  const query = rawQuery.normalize("NFC").trim();
  if ([...query].length < MIN_QUERY) return { hits: [], elapsedMs: 0 };
  const piece = serverPiece(query);
  // "**" 처럼 * 뿐이면 찾을 글자가 없다
  if (!piece) return { hits: [], elapsedMs: 0 };
  const wide = piece !== query;

  const started = performance.now();
  let request = getSupabase()
    .from("messages")
    .select("id, channel_id, parent_id, user_id, author, body, created_at")
    .ilike("body", `%${escapeLike(piece)}%`)
    .is("deleted_at", null)
    .order("id", { ascending: false })
    .limit(wide ? WIDE_FETCH : MAX_RESULTS);
  if (options.channelId) request = request.eq("channel_id", options.channelId);
  const { data, error } = await request;
  const elapsedMs = performance.now() - started;
  if (error) throw new Error(error.message);

  const needle = normalize(query);
  const hits = ((data ?? []) as SearchHit[])
    .filter((m) => normalize(m.body).includes(needle))
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
