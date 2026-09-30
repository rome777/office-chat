"use client";

// ③ 조직도 페이지 (/org, 2026-09-30 WU-36). 왼쪽 넓은 칸 = 다이어그램, 오른쪽 = 계층 목록. 선택은 양쪽이 같이 쓴다.
// ?unit=<조직 id> 로 그 조직을 고른 채 열고, ?channel=<채널 id> 면 그 채널의 부서를 고른다 (주소로만 — 메시지 화면에는 조직도 버튼이 없다).
// 둘 다 없으면 내 소속 조직. 1180px 미만에서는 두 칸을 나란히 두면 다이어그램이 너무 작아져 위의 버튼으로 하나씩 본다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMyProfile } from "@/components/profile/profileSource";
import { useMyChannels } from "@/components/sidebar/useChannels";
import { GENERAL_ID } from "@/components/sidebar/channelSource";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import OrgDiagram from "./OrgDiagram";
import OrgTree from "./OrgTree";
import { TREE_MIN, usePaneLayout } from "./usePaneLayout";
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
  const userPicked = useRef(false);
  const pane = usePaneLayout();
  const splitRef = useRef<HTMLDivElement>(null);

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
    // 사용자가 아직 고르지 않았으면, 내 프로필이 늦게 와도(새로 열었을 때) 내 소속으로 다시 고른다
    if (unitParam || channelParam || !userPicked.current) setSelected(pick);
  }, [org, unitParam, channelParam, profile?.org_unit_id]);

  const select = useCallback(
    (id: string) => {
      userPicked.current = true;
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

      <div
        ref={splitRef}
        className={`${s.split} ${pane.open ? "" : s.treeClosed} ${mobileView === "tree" ? s.showTree : s.showDiagram}`}
        style={{ "--tree-w": `${pane.width}px` } as React.CSSProperties}
      >
        <OrgDiagram org={org} selected={selected} dimmed={search?.dimmed ?? null} onSelect={select} />
        {pane.open ? (
          <Splitter
            box={splitRef}
            width={pane.width}
            onResize={pane.resize}
            onReset={pane.reset}
          />
        ) : (
          <button type="button" className={s.treeTab} onClick={pane.toggle} aria-label="목록 펼치기" title="목록 펼치기">
            <span aria-hidden="true">◂</span>
            <span className={s.treeTabText}>목록</span>
          </button>
        )}
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
          onClosePane={pane.toggle}
        />
      </div>
    </div>
  );
}

/** 다이어그램과 목록 사이 손잡이. 끌어서 목록 폭을 바꾼다 (260px ~ 칸의 절반). 더블클릭하면 기본 폭, ←/→ 로도 */
function Splitter({
  box,
  width,
  onResize,
  onReset,
}: {
  box: React.RefObject<HTMLDivElement | null>;
  width: number;
  onResize: (w: number, max: number) => void;
  onReset: () => void;
}) {
  const max = () => Math.max(TREE_MIN, (box.current?.clientWidth ?? 1200) * 0.5);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="목록 폭 조절"
      aria-valuenow={width}
      aria-valuemin={TREE_MIN}
      tabIndex={0}
      className={s.splitter}
      title="끌어서 폭 조절 · 더블클릭하면 처음 폭"
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const right = box.current?.getBoundingClientRect().right ?? window.innerWidth;
        const move = (ev: PointerEvent) => onResize(right - ev.clientX - 6, max());
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          document.body.style.cursor = "";
        };
        document.body.style.cursor = "col-resize";
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width + 20, max());
        if (e.key === "ArrowRight") onResize(width - 20, max());
      }}
    >
      <span className={s.grip} aria-hidden="true" />
    </div>
  );
}
