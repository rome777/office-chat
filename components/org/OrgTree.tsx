"use client";

// ③ 조직도 계층 목록 (오른쪽 칸). 조직마다 그 조직에 바로 속한 사람(장 먼저)을 보이고, 그 아래 하위 조직.
// 처음에는 전부 펼친다. 조직을 누르면 선택(다이어그램과 같이 바뀜), 꺾쇠로 접고 펼친다. 사람을 누르면 프로필 카드.

import { useEffect, useRef } from "react";
import type { OrgMember, OrgUnit } from "@/lib/types/org";
import { LEADER_LABEL } from "@/lib/types/org";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { openProfileCard } from "@/components/shell/cardStore";
import { headcount, type OrgData } from "./orgSource";
import s from "./org.module.css";

export default function OrgTree({
  org,
  me,
  selected,
  collapsed,
  visible,
  people,
  onSelect,
  onToggle,
  onExpandAll,
  onCollapseAll,
  onClosePane,
}: {
  org: OrgData;
  me: string | null;
  selected: string | null;
  collapsed: ReadonlySet<string>;
  /** 찾기 중이면 보일 조직 (맞는 것과 그 위 조직). null 이면 전부 */
  visible: ReadonlySet<string> | null;
  /** 찾기 중이면 보일 사람. null 이면 전부 */
  people: ReadonlySet<string> | null;
  onSelect: (unitId: string) => void;
  onToggle: (unitId: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  /** 목록 칸을 접는다 (다이어그램이 전체 폭) */
  onClosePane: () => void;
}) {
  const rows = useRef(new Map<string, HTMLDivElement>());
  const list = useRef<HTMLDivElement>(null);

  // 다이어그램에서 고르면 그 줄로 스크롤한다 (목록 칸 안에서만)
  useEffect(() => {
    const row = selected ? rows.current.get(selected) : null;
    const box = list.current;
    if (!row || !box) return;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top + 8 || r.bottom > b.bottom - 8) box.scrollTo({ top: box.scrollTop + r.top - b.top - 60, behavior: "smooth" });
  }, [selected]);

  if (!org.root) return null;

  const unitRow = (u: OrgUnit, depth: number): React.ReactNode => {
    if (visible && !visible.has(u.id)) return null;
    const open = !collapsed.has(u.id);
    const kids = org.children.get(u.id) ?? [];
    const members = (org.members.get(u.id) ?? []).filter((m) => !people || people.has(m.id));
    const on = u.id === selected;
    return (
      <div key={u.id} className={depth > 0 ? s.kids : undefined}>
        <div
          ref={(el) => {
            if (el) rows.current.set(u.id, el);
            else rows.current.delete(u.id);
          }}
          className={`${s.row} ${on ? s.rowOn : ""}`}
        >
          <button
            type="button"
            className={s.caret}
            aria-expanded={open}
            aria-label={open ? `${u.name} 접기` : `${u.name} 펼치기`}
            onClick={() => onToggle(u.id)}
          >
            {open ? "▾" : "▸"}
          </button>
          <button type="button" className={s.unitButton} aria-current={on ? "true" : undefined} onClick={() => onSelect(u.id)}>
            <span className={`${s.square} ${s[u.kind]}`} aria-hidden="true" />
            <span className={s.unitName}>{u.name}</span>
            <span className={s.count}>{headcount(org, u.id)}</span>
          </button>
        </div>
        {open && (members.length > 0 || kids.length > 0) && (
          <div className={s.kids}>
            {members.map((m) => (
              <PersonRow key={m.id} person={m} unit={u} isMe={m.id === me} />
            ))}
            {kids.map((k) => unitRow(k, 0))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className={s.tree} aria-label="조직도 목록">
      <div className={s.treeBar}>
        <button type="button" className="link" onClick={onExpandAll}>
          모두 펼치기
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className="link" onClick={onCollapseAll}>
          모두 접기
        </button>
        <button type="button" className={s.paneClose} onClick={onClosePane} aria-label="목록 칸 접기" title="목록 칸 접기">
          접기 ▸
        </button>
      </div>
      <div className={s.treeList} ref={list}>
        {unitRow(org.root, 0)}
        {visible && visible.size === 0 && <p className={s.empty}>맞는 사람·부서가 없습니다</p>}
      </div>
    </section>
  );
}

function PersonRow({ person, unit, isMe }: { person: OrgMember; unit: OrgUnit; isMe: boolean }) {
  const lead = person.id === unit.leader_id;
  const meta = [person.title, lead ? LEADER_LABEL[unit.kind] : null, isMe ? "나" : null].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className={`${s.row} ${s.person} ${lead ? `${s.lead} ${s[unit.kind]}` : ""}`}
      onClick={() => openProfileCard(person.id)}
      aria-label={`${person.display_name} ${meta} — 프로필`}
    >
      <PersonAvatar userId={person.id} name={person.display_name} size={22} />
      <span className={s.personName}>{person.display_name}</span>
      <span className={s.meta}>{meta}</span>
    </button>
  );
}
