"use client";

// ③ 조직도 패널. 부서 채널에서 열면 그 부서(와 하위 조직)만, 그 밖의 채널에서는 회사 전체를 보여 준다.
// 위쪽 경로(회사 › 사업부 › …)를 누르면 범위를 넓히고, 하위 조직의 "보기"를 누르면 그 조직으로 좁힌다.
// 사람을 누르면 그 사람과의 DM 을 연다 (② 의 startDm 을 가져다 쓴다).

import { useEffect, useState } from "react";
import { getMyUserId, startDm } from "@/components/sidebar/channelSource";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import type { OrgMember, OrgUnit } from "@/lib/types/org";
import { KIND_LABEL, LEADER_LABEL } from "@/lib/types/org";
import { headcount, loadOrg, pathTo, type OrgData } from "./orgSource";
import s from "./org.module.css";

export default function OrgChartPanel() {
  const { channel, setChannel, closePanel } = useWorkspace();
  const [org, setOrg] = useState<OrgData | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 사용자가 경로·하위 조직을 눌러 바꾼 범위. 채널이 바뀌면 그 채널의 조직으로 돌아간다
  const [picked, setPicked] = useState<{ channelId: string; unitId: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadOrg().then(
      (d) => alive && setOrg(d),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    getMyUserId().then(
      (id) => alive && setMe(id),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="error-text">조직도를 불러오지 못했습니다: {error}</p>;
  if (!org) return <p className="muted">불러오는 중…</p>;
  if (!org.root) return <p className="muted">등록된 조직이 없습니다.</p>;

  const channelUnit = [...org.units.values()].find((u) => u.channel_id === channel.id) ?? null;
  const scope =
    (picked?.channelId === channel.id && org.units.get(picked.unitId)) || channelUnit || org.root;
  const focus = (u: OrgUnit) => setPicked({ channelId: channel.id, unitId: u.id });

  async function openDm(p: OrgMember) {
    setOpening(p.id);
    setError(null);
    try {
      const id = await startDm(p.id);
      setChannel({ id, name: p.display_name, type: "dm" });
      closePanel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpening(null);
    }
  }

  const path = pathTo(org, scope.id);

  return (
    <div className={s.org}>
      {!channelUnit && scope.id === org.root.id && (
        <p className={s.note}>부서 채널이 아니라서 회사 전체 조직도를 보여 줍니다.</p>
      )}
      <nav className={s.path} aria-label="조직 경로">
        {path.map((u, i) => (
          <span key={u.id}>
            {i > 0 && <span className={s.sep}>›</span>}
            {u.id === scope.id ? (
              <strong>{u.name}</strong>
            ) : (
              <button className="link" onClick={() => focus(u)}>
                {u.name}
              </button>
            )}
          </span>
        ))}
      </nav>
      <p className={s.summary}>
        {KIND_LABEL[scope.kind]} · {headcount(org, scope.id)}명
        {channelUnit && scope.id !== channelUnit.id && (
          <>
            {" · "}
            <button className="link" onClick={() => setPicked(null)}>
              이 채널 부서로
            </button>
          </>
        )}
      </p>
      <UnitBody org={org} unit={scope} depth={0} me={me} opening={opening} onFocus={focus} onDm={openDm} />
    </div>
  );
}

type BodyProps = {
  org: OrgData;
  unit: OrgUnit;
  depth: number;
  me: string | null;
  opening: string | null;
  onFocus: (u: OrgUnit) => void;
  onDm: (p: OrgMember) => void;
};

function UnitBody({ org, unit, depth, me, opening, onFocus, onDm }: BodyProps) {
  const people = org.members.get(unit.id) ?? [];
  const subs = org.children.get(unit.id) ?? [];
  return (
    <>
      {people.length > 0 && (
        <ul className={s.people}>
          {people.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              role={p.id === unit.leader_id ? LEADER_LABEL[unit.kind] : null}
              isMe={p.id === me}
              busy={opening === p.id}
              onDm={onDm}
            />
          ))}
        </ul>
      )}
      {subs.map((c) => (
        // 회사 전체를 볼 때는 사업부까지만 펼친다 (한 화면에 너무 길어진다)
        <details key={c.id} className={s.unit} open={depth === 0 || unit.kind !== "company"}>
          <summary>
            <span className={s.unitName}>{c.name}</span>
            <span className={s.unitMeta}>
              {KIND_LABEL[c.kind]} · {headcount(org, c.id)}명
            </span>
            <button
              className={`link ${s.focus}`}
              onClick={(e) => {
                e.preventDefault();
                onFocus(c);
              }}
            >
              보기
            </button>
          </summary>
          <UnitBody org={org} unit={c} depth={depth + 1} me={me} opening={opening} onFocus={onFocus} onDm={onDm} />
        </details>
      ))}
      {people.length === 0 && subs.length === 0 && <p className="muted">소속된 사람이 없습니다.</p>}
    </>
  );
}

function PersonRow({
  person,
  role,
  isMe,
  busy,
  onDm,
}: {
  person: OrgMember;
  role: string | null;
  isMe: boolean;
  busy: boolean;
  onDm: (p: OrgMember) => void;
}) {
  return (
    <li className={s.person}>
      <span className={s.avatar} aria-hidden>
        {person.display_name.slice(0, 1)}
      </span>
      <span className={s.who}>
        <span className={s.name}>
          {person.display_name}
          {person.title && <span className={s.title}>{person.title}</span>}
          {role && <span className={s.role}>{role}</span>}
        </span>
        <span className={s.handle}>@{person.handle}</span>
      </span>
      {isMe ? (
        <span className={s.me}>나</span>
      ) : (
        <button
          className={s.dm}
          onClick={() => onDm(person)}
          disabled={busy}
          aria-label={`${person.display_name}에게 메시지`}
        >
          {busy ? "여는 중…" : "메시지"}
        </button>
      )}
    </li>
  );
}
