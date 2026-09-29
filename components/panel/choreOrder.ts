// ③ 잡무 수첩 → 주문 정리. 오늘 갈 사람의 기록을 같은 내용끼리 묶어 한 번에 말할 수 있는 글로 만든다.
// AI 를 쓰지 않는다: 적어 둔 글자를 그대로 묶는다 (띄어쓰기·대소문자만 무시). "아아"와 "아이스 아메리카노"는 다른 것으로 센다.

import type { ChoreEntry, ChoreList } from "@/lib/types/chores";

const norm = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();

export function orderText(list: Pick<ChoreList, "title" | "place">, entries: ChoreEntry[]): string {
  const groups = new Map<string, { detail: string; names: string[] }>();
  for (const e of entries) {
    const key = norm(e.detail);
    const g = groups.get(key) ?? { detail: e.detail.trim(), names: [] };
    g.names.push(e.person_name.trim());
    groups.set(key, g);
  }
  const lines = [...groups.values()]
    .sort((a, b) => b.names.length - a.names.length)
    .map((g) => `- ${g.detail}${g.names.length > 1 ? ` ×${g.names.length}` : ""} (${g.names.join(", ")})`);
  const head = `[${list.title.trim()}] ${entries.length}명${list.place.trim() ? ` · ${list.place.trim()}` : ""}`;
  return [head, ...lines].join("\n");
}

/** 사람별 보기: 이름(띄어쓰기 무시)으로 묶어 목록마다 무엇인지 */
export function byPerson(lists: ChoreList[]): { name: string; items: { list: string; detail: string }[] }[] {
  const people = new Map<string, { name: string; items: { list: string; detail: string }[] }>();
  for (const l of lists) {
    for (const e of l.chore_entries) {
      const key = norm(e.person_name);
      const p = people.get(key) ?? { name: e.person_name.trim(), items: [] };
      p.items.push({ list: l.title, detail: e.detail });
      people.set(key, p);
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
