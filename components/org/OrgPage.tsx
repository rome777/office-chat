"use client";

// ③ 조직도 페이지 (/org, 2026-09-30 WU-36). 왼쪽 넓은 칸 = 다이어그램, 오른쪽 = 계층 목록. 선택은 양쪽이 같이 쓴다.
// ?unit=<조직 id> 로 그 조직을 고른 채 열고, ?channel=<채널 id> 면 그 채널의 부서를 고른다 (채팅 "⋯ → 조직도").
// 둘 다 없으면 내 소속 조직. 좁은 화면(900px 미만)에서는 두 칸을 나란히 못 두어 위의 버튼으로 하나씩 본다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMyProfile } from "@/components/profile/profileSource";
import { useMyChannels } from "@/components/sidebar/useChannels";
import { GENERAL_ID } from "@/components/sidebar/channelSource";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import OrgDiagram from "./OrgDiagram";
import OrgTree from "./OrgTree";
import { headcount, loadOrg, pathTo, type OrgData } from "./orgSource";
import s from "./org.module.css";

const norm = (v: string | null | undefined) => (v ?? "").normalize("NFC").toLowerCase();

export default function OrgPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { profile } = useMyProfile();
  const { channels } = useMyChannels();
  const { setChannel } = useWorkspace();
  const [org, setOrg] = useState<OrgData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [mobileView, setMobileView] = useState<"diagram" | "tree">("diagram");

  useEffect(() => {
    let alive = true;
    loadOrg().then(
      (d) => alive && setOrg(d),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, []);

  // 처음 고를 조직: 주소의 unit → 주소의 channel 의 부서 → 내 소속 → 회사
  const unitParam = params.get("unit");
  const channelParam = params.get("channel");
  useEffect(() => {
    if (!org?.root) return;
    const byChannel = channelParam ? [...org.units.values()].find((u) => u.channel_id === channelParam)?.id : undefined;
    const pick =
      (unitParam && org.units.has(unitParam) ? unitParam : undefined) ??
      byChannel ??
      (profile?.org_unit_id && org.units.has(profile.org_unit_id) ? profile.org_unit_id : undefined) ??
      org.root.id;
    setSelected((cur) => (unitParam || channelParam || !cur ? pick : cur));
  }, [org, unitParam, channelParam, profile?.org_unit_id]);

  const select = useCallback(
    (id: string) => {
      setSelected(id);
      // 고른 조직이 목록에서 접힌 곳 안에 있으면 펼친다
      if (org) {
        const ups = pathTo(org, id).map((u) => u.id);
        setCollapsed((c) => {
          if (!ups.some((u) => c.has(u))) return c;
          const next = new Set(c);
          ups.forEach((u) => next.delete(u));
          return next;
        });
      }
      router.replace(`${pathname}?unit=${encodeURIComponent(id)}`, { scroll: false });
    },
    [org, pathname, router],
  );

  const path = useMemo(() => new Set(org && selected ? pathTo(org, selected).map((u) => u.id) : []), [org, selected]);

  // 찾기: 이름·직급·조직 이름. 맞는 사람의 조직과 맞는 조직, 그 위 조직을 보인다
  const search = useMemo(() => {
    const q = norm(query.trim());
    if (!org || !q) return null;
    const hitUnits = new Set<string>();
    const hitPeople = new Set<string>();
    for (const u of org.units.values()) if (norm(u.name).includes(q)) hitUnits.add(u.id);
    for (const [unitId, list] of org.members) {
      for (const m of list) {
        if ([m.display_name, m.title, m.handle].some((v) => norm(v).includes(q))) {
          hitPeople.add(m.id);
          hitUnits.add(unitId);
        }
      }
    }
    const visible = new Set<string>();
    for (const id of hitUnits) pathTo(org, id).forEach((u) => visible.add(u.id));
    // 조직 이름이 맞으면 그 조직 사람은 모두 보인다
    const people = new Set(hitPeople);
    for (const id of hitUnits) if (norm(org.units.get(id)?.name).includes(q)) org.members.get(id)?.forEach((m) => people.add(m.id));
    const dimmed = new Set([...org.units.keys()].filter((id) => !hitUnits.has(id)));
    return { visible, people, dimmed, first: [...hitUnits][0] ?? null };
  }, [org, query]);

  if (error) return <p className={`${s.page} error-text`}>조직도를 불러오지 못했습니다: {error}</p>;
  if (!org) return <p className={`${s.page} muted`}>불러오는 중…</p>;
  if (!org.root) return <p className={`${s.page} muted`}>등록된 조직이 없습니다.</p>;

  const unit = selected ? org.units.get(selected) : null;
  const trail = unit ? pathTo(org, unit.id) : [];
  // 부서 채널은 내가 멤버일 때만 열 수 있다 (비공개). 회사 채널(#일반)은 목록에서 숨겨서 뺀다
  const canOpen = !!unit && unit.channel_id !== GENERAL_ID && !!channels?.some((c) => c.id === unit.channel_id);

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1>조직도</h1>
        <span className={s.headMeta}>
          {headcount(org, org.root.id)}명 · 조직 {org.units.size}개
        </span>
        <span className={s.grow} />
        <div className={s.switch} role="tablist" aria-label="보기">
          <button type="button" role="tab" aria-selected={mobileView === "diagram"} onClick={() => setMobileView("diagram")}>
            다이어그램
          </button>
          <button type="button" role="tab" aria-selected={mobileView === "tree"} onClick={() => setMobileView("tree")}>
            목록
          </button>
        </div>
        <label className={s.search}>
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            placeholder="이름 · 직급 · 부서 찾기"
            aria-label="이름 · 직급 · 부서 찾기"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && search?.first) select(search.first);
              if (e.key === "Escape") setQuery("");
            }}
          />
        </label>
      </header>

      {unit && (
        <div className={s.picked}>
          <span className={`${s.square} ${s[unit.kind]}`} aria-hidden="true" />
          <strong>{unit.name}</strong>
          <span className={s.trail}>
            {trail
              .slice(0, -1)
              .map((u) => u.name)
              .join(" › ")}
            {trail.length > 1 ? " · " : ""}
            {headcount(org, unit.id)}명
          </span>
          {canOpen && (
            <button
              type="button"
              className={s.channelButton}
              onClick={() => {
                setChannel({ id: unit.channel_id, name: unit.name, type: "private" });
                router.push(`/chat?c=${encodeURIComponent(unit.channel_id)}`);
              }}
            >
              # 부서 채널
            </button>
          )}
        </div>
      )}

      <div className={`${s.split} ${mobileView === "tree" ? s.showTree : s.showDiagram}`}>
        <OrgDiagram org={org} selected={selected} path={path} dimmed={search?.dimmed ?? null} onSelect={select} />
        <OrgTree
          org={org}
          me={profile?.id ?? null}
          selected={selected}
          collapsed={collapsed}
          visible={search?.visible ?? null}
          people={search?.people ?? null}
          onSelect={select}
          onToggle={(id) =>
            setCollapsed((c) => {
              const next = new Set(c);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onExpandAll={() => setCollapsed(new Set())}
          onCollapseAll={() => setCollapsed(new Set([...org.units.keys()].filter((id) => id !== org.root!.id)))}
        />
      </div>
    </div>
  );
}
