"use client";

// ① 입력창의 @ 자동완성 목록. 채널 멤버를 handle·이름으로 거른다. 고르면 "@handle " 로 바꿔 넣는다.
// 키보드(↑↓·Enter·Tab·Esc)는 Composer 가 받아서 이 목록을 움직인다.

import type { Member } from "./useChannelMembers";
import s from "./chat.module.css";

/** 커서 앞 글이 "@찾는말" 로 끝나면 찾는말을 돌려준다. 앞이 글자인 @ (메일 주소)는 멘션이 아니다 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1].length - 1, query: match[1] };
}

export function filterMembers(members: Member[], query: string, selfId: string | null, limit = 6): Member[] {
  const q = query.toLowerCase();
  return members
    .filter((m) => m.id !== selfId)
    .filter((m) => !q || m.handle.toLowerCase().includes(q) || m.display_name.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.handle.toLowerCase().startsWith(q)) - Number(!b.handle.toLowerCase().startsWith(q)))
    .slice(0, limit);
}

export default function MentionPicker({
  items,
  active,
  onPick,
}: {
  items: Member[];
  active: number;
  onPick: (m: Member) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={s.mentionPicker} role="listbox" aria-label="멘션할 사람">
      {items.map((m, i) => (
        <li
          key={m.id}
          role="option"
          aria-selected={i === active}
          className={i === active ? s.mentionActive : undefined}
          // 입력창 포커스를 잃지 않게 mousedown 에서 고른다
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(m);
          }}
        >
          <strong>{m.display_name}</strong> <span className="muted">@{m.handle}</span>
          {m.department && <span className="muted"> · {m.department}</span>}
        </li>
      ))}
    </ul>
  );
}
