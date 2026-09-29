"use client";

// ① 입력창의 @ 자동완성 목록. 채널 멤버를 이름·부서·직급으로 거른다. 고르면 "@이름 " 을 넣고, 보낼 때 아이디로 바꿔 저장한다 (lib/mentions).
// 아이디는 화면에 보이지 않는다 — 동명이인은 부서·직급으로 가린다 (2026-09-29).
// 사람 말고도 "모두"(이 채널 멤버 전체)와, 이 채널에 소속 직원이 있는 부서(하위 부서 포함)를 부를 수 있다 (2026-09-30).
// 키보드(↑↓·Enter·Tab·Esc)는 Composer 가 받아서 이 목록을 움직인다.

import { ALL_LABEL, ALL_TOKEN, orgToken, unitChain, type MentionUnit } from "@/lib/mentions";
import type { Member } from "./useChannelMembers";
import s from "./chat.module.css";

/** 커서 앞 글이 "@찾는말" 로 끝나면 찾는말을 돌려준다. 앞이 글자인 @ (메일 주소)는 멘션이 아니다 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1].length - 1, query: match[1] };
}

/** 자동완성 한 줄: 사람, 또는 모두·부서 (token 은 본문에 저장할 글자, label 은 입력창·화면에 보일 이름) */
export type MentionItem =
  | { kind: "person"; key: string; member: Member }
  | { kind: "group"; key: string; token: string; label: string; count: number; note: string };

/** 이 채널의 부를 수 있는 모두·부서. 부서는 이 채널 멤버가 소속된 부서와 그 상위 부서 — 인원은 하위 부서까지 센다 */
export function channelGroups(members: Member[], units: readonly MentionUnit[], selfId: string | null): MentionItem[] {
  const others = members.filter((m) => m.id !== selfId);
  if (others.length === 0) return [];
  const count = new Map<string, number>();
  for (const m of others) for (const id of unitChain(m.org_unit_id, units)) count.set(id, (count.get(id) ?? 0) + 1);
  const groups: MentionItem[] = units
    .filter((u) => count.has(u.id))
    .map((u) => ({ kind: "group", key: u.id, token: orgToken(u.id), label: u.name, count: count.get(u.id)!, note: "부서" }));
  return [{ kind: "group", key: ALL_TOKEN, token: ALL_TOKEN, label: ALL_LABEL, count: others.length, note: "이 채널 전체" }, ...groups];
}

/** @ 만 쳤을 때 모두 다음에 먼저 보일 부서 수 (사람에게 밀려 부서가 안 보이지 않게) */
const GROUPS_FIRST = 3;

export function filterMentions(members: Member[], groups: MentionItem[], query: string, selfId: string | null, limit = 10): MentionItem[] {
  const q = query.toLowerCase();
  const starts = (name: string) => Number(!name.toLowerCase().startsWith(q));
  const byStart = (name: (it: MentionItem) => string) => (a: MentionItem, b: MentionItem) => starts(name(a)) - starts(name(b));
  const people: MentionItem[] = members
    .filter((m) => m.id !== selfId)
    .filter((m) => !q || [m.display_name, m.department, m.title].some((v) => (v ?? "").toLowerCase().includes(q)))
    .map((m) => ({ kind: "person", key: m.id, member: m }));
  const matched = groups.filter((g) => g.kind === "group" && (!q || g.label.toLowerCase().includes(q)));
  // 찾는말이 없으면 모두 → 부서 몇 개 → 사람. 있으면 맞는 부서를 먼저(수가 적고, 부서 이름을 쳤다면 부서를 찾는 것), 그다음 사람.
  // 전에는 사람을 먼저 두어 "@" 만 치면 부서가 한 줄도 안 보였다 (2026-09-30)
  if (!q) return [...matched.slice(0, 1 + GROUPS_FIRST), ...people, ...matched.slice(1 + GROUPS_FIRST)].slice(0, limit);
  const groupName = (it: MentionItem) => (it.kind === "group" ? it.label : "");
  const personName = (it: MentionItem) => (it.kind === "person" ? it.member.display_name : "");
  return [...matched.sort(byStart(groupName)), ...people.sort(byStart(personName))].slice(0, limit);
}

export default function MentionPicker({
  items,
  active,
  onPick,
}: {
  items: MentionItem[];
  active: number;
  onPick: (item: MentionItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={s.mentionPicker} role="listbox" aria-label="멘션할 사람">
      {items.map((it, i) => (
        <li
          key={it.key}
          role="option"
          aria-selected={i === active}
          className={i === active ? s.mentionActive : undefined}
          // 입력창 포커스를 잃지 않게 mousedown 에서 고른다
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(it);
          }}
        >
          <strong>{it.kind === "person" ? it.member.display_name : it.label}</strong>
          {(it.kind === "person" ? [it.member.department, it.member.title] : [it.note, `${it.count}명`]).filter(Boolean).map((v) => (
            <span key={v} className="muted"> · {v}</span>
          ))}
        </li>
      ))}
    </ul>
  );
}
