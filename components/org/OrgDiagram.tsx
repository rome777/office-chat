"use client";

// ③ 조직도 다이어그램 (위 → 아래, 처음부터 전부 펼침). 연결선은 직선·직각이다 (2026-09-30 사용자 결정).
// 회사·사업부·본부는 카드, 팀은 알약. 아래가 모두 팀인 조직은 팀 알약을 그 밑에 세로로 쌓아 폭을 줄인다.
// 선택한 조직까지의 선을 강조하고, 찾기 중이면 맞지 않는 조직을 흐리게 한다. 확대·축소·끌어서 이동.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OrgUnit } from "@/lib/types/org";
import { headcount, leaderOf, pathTo, type OrgData } from "./orgSource";
import s from "./org.module.css";

const PAD = 24;
const GAP_X = 16; // 옆 조직 사이
const GAP_Y = 44; // 위 조직 아래 ~ 아래 조직 위
const STACK_TOP = 26; // 카드 아래 ~ 첫 팀 알약
const STACK_GAP = 8; // 팀 알약 사이
const CARD = { company: { w: 240, h: 64 }, other: { w: 168, h: 60 } };
const CHIP = { w: 144, h: 34 };
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const FIT_MAX = 1.5; // 칸에 맞출 때 최대 배율
const FIT_PAD = 24; // 칸에 맞출 때 남길 여백(px)

/** stack: 아래 조직(팀)을 세로로 쌓았다 */
type Node = { unit: OrgUnit; x: number; y: number; w: number; h: number; chip: boolean; stack: boolean };
type Seg = { d: string; from: string; to: string };

/** 조직 나무를 자리 잡는다. 결과: 노드 자리, 연결선(부모·자식 id 와 함께), 전체 크기 */
function layout(org: OrgData) {
  const nodes = new Map<string, Node>();
  const segs: Seg[] = [];
  const kids = (u: OrgUnit) => org.children.get(u.id) ?? [];
  const isChip = (u: OrgUnit) => u.kind === "team" && kids(u).length === 0;
  const stacks = (u: OrgUnit) => kids(u).length > 0 && kids(u).every(isChip);
  const size = (u: OrgUnit) => (isChip(u) ? CHIP : u.kind === "company" ? CARD.company : CARD.other);

  const widths = new Map<string, number>();
  const measure = (u: OrgUnit): number => {
    const self = size(u).w;
    const c = kids(u);
    let w = self;
    if (c.length && stacks(u)) w = Math.max(self, CHIP.w);
    else if (c.length) w = Math.max(self, c.reduce((n, k) => n + measure(k), 0) + GAP_X * (c.length - 1));
    widths.set(u.id, w);
    return w;
  };

  let bottom = 0;
  const place = (u: OrgUnit, left: number, top: number): number => {
    const { w, h } = size(u);
    const c = kids(u);
    const width = widths.get(u.id)!;
    let cx = left + width / 2;
    if (c.length && !stacks(u)) {
      const span = c.reduce((n, k) => n + widths.get(k.id)!, 0) + GAP_X * (c.length - 1);
      let x = left + (width - span) / 2;
      const centers = c.map((k) => {
        const kc = place(k, x, top + h + GAP_Y);
        x += widths.get(k.id)! + GAP_X;
        return kc;
      });
      cx = (centers[0] + centers[centers.length - 1]) / 2;
      const bus = top + h + GAP_Y / 2;
      c.forEach((k, i) => {
        // 부모 아래 → 가로선 높이 → 자식 가운데 → 자식 위. 강조를 자식마다 따로 그리려고 자식마다 한 줄로 만든다
        segs.push({ d: `M${cx} ${top + h} V${bus} H${centers[i]} V${top + h + GAP_Y}`, from: u.id, to: k.id });
      });
    } else if (c.length) {
      let y = top + h + STACK_TOP;
      let prevBottom = top + h;
      c.forEach((k) => {
        nodes.set(k.id, { unit: k, x: cx - CHIP.w / 2, y, w: CHIP.w, h: CHIP.h, chip: true, stack: false });
        segs.push({ d: `M${cx} ${prevBottom} V${y}`, from: u.id, to: k.id });
        prevBottom = y + CHIP.h;
        y += CHIP.h + STACK_GAP;
      });
      bottom = Math.max(bottom, prevBottom);
    }
    nodes.set(u.id, { unit: u, x: cx - w / 2, y: top, w, h, chip: isChip(u), stack: c.length > 0 && stacks(u) });
    bottom = Math.max(bottom, top + h);
    return cx;
  };

  if (!org.root) return { nodes, segs, width: 0, height: 0 };
  const total = measure(org.root);
  place(org.root, PAD, PAD);
  return { nodes, segs, width: total + PAD * 2, height: bottom + PAD };
}

export default function OrgDiagram({
  org,
  selected,
  dimmed,
  onSelect,
}: {
  org: OrgData;
  selected: string | null;
  /** 찾기 중 맞지 않는 조직 (없으면 찾기 중이 아님) */
  dimmed: ReadonlySet<string> | null;
  onSelect: (unitId: string) => void;
}) {
  const { nodes, segs, width, height } = useMemo(() => layout(org), [org]);
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const touched = useRef(false); // 사용자가 확대·축소를 했으면 창 크기가 바뀌어도 맞추지 않는다
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // 칸의 가로·세로에 모두 들어가는 배율. 큰 화면에서는 100% 넘게 키운다 (칸만 커지고 그림이 작아 보이지 않게, 2026-09-30)
  const fitZoom = useCallback(() => {
    const el = box.current;
    if (!el || !width || !height) return 1;
    const z = Math.min((el.clientWidth - FIT_PAD) / width, (el.clientHeight - FIT_PAD) / height);
    return Math.round(Math.max(ZOOM_MIN, Math.min(FIT_MAX, z)) * 100) / 100;
  }, [width, height]);

  // 처음과 창 크기가 바뀔 때마다 맞춘다. 사용자가 직접 확대·축소했으면 그 배율을 둔다
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const refit = () => {
      if (!touched.current) setZoom(fitZoom());
    };
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitZoom]);

  // 선택한 조직이 화면 밖이면 가운데로 옮긴다 (목록에서 골랐을 때)
  useEffect(() => {
    const el = box.current;
    const n = selected ? nodes.get(selected) : null;
    if (!el || !n) return;
    const cx = (n.x + n.w / 2) * zoom;
    const cy = (n.y + n.h / 2) * zoom;
    const inView = cx > el.scrollLeft + 40 && cx < el.scrollLeft + el.clientWidth - 40 && cy > el.scrollTop + 40 && cy < el.scrollTop + el.clientHeight - 40;
    if (!inView) el.scrollTo({ left: cx - el.clientWidth / 2, top: cy - el.clientHeight / 2, behavior: "smooth" });
  }, [selected, nodes, zoom]);

  const zoomBy = (f: number) => {
    touched.current = true;
    setZoom((z) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * f)) * 100) / 100);
  };
  const fit = () => {
    touched.current = false;
    setZoom(fitZoom());
  };

  // 선택한 조직까지의 강조선: 조각을 겹쳐 그리지 않고 회사부터 한 줄로 (2026-09-30 사용자 선택 "B. 끊김 없는 한 줄").
  // 조각으로 그리면 꺾이는 곳마다 굵기가 바뀌고, 쌓인 팀은 본부 → 첫 팀 구간이 회색으로 남아 끊겨 보였다.
  // 쌓인 팀은 본부 아래에서 고른 팀까지 곧게 내려간다 (위의 팀 알약 뒤로 지나간다)
  const litPath = useMemo(() => {
    if (!selected) return "";
    const chain = pathTo(org, selected)
      .map((u) => nodes.get(u.id))
      .filter((n): n is Node => !!n);
    let d = "";
    for (let i = 1; i < chain.length; i++) {
      const p = chain[i - 1];
      const c = chain[i];
      const px = p.x + p.w / 2;
      const cx = c.x + c.w / 2;
      const bottom = p.y + p.h;
      d += p.stack
        ? `M${px} ${bottom} V${c.y} `
        : `M${px} ${bottom} V${bottom + GAP_Y / 2} H${cx} V${c.y} `;
    }
    return d.trim();
  }, [org, selected, nodes]);

  return (
    <section className={s.diagram} aria-label="조직도 다이어그램">
      <div
        ref={box}
        className={s.canvas}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-node]")) return;
          const el = box.current!;
          drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
          el.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const el = box.current;
          if (!d || !el) return;
          el.scrollLeft = d.left - (e.clientX - d.x);
          el.scrollTop = d.top - (e.clientY - d.y);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`} className={s.svg}>
          <g className={s.edges}>
            {segs.map((seg) => (
              <path key={`${seg.from}-${seg.to}`} d={seg.d} />
            ))}
          </g>
          {litPath && <path className={s.edgeLit} d={litPath} />}
          {[...nodes.values()].map((n) => (
            <UnitNode
              key={n.unit.id}
              node={n}
              org={org}
              selected={n.unit.id === selected}
              dim={!!dimmed?.has(n.unit.id)}
              onSelect={onSelect}
            />
          ))}
        </svg>
      </div>
      <div className={s.diagramBar}>
        <span className={s.legend}>
          <span className={`${s.swatch} ${s.company}`} /> 회사
          <span className={`${s.swatch} ${s.division}`} /> 사업부
          <span className={`${s.swatch} ${s.hq}`} /> 본부
          <span className={`${s.swatch} ${s.team}`} /> 팀
        </span>
        <span className={s.zoom}>
          <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="축소">
            −
          </button>
          <button type="button" onClick={fit} title="칸에 맞추기">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="확대">
            +
          </button>
        </span>
      </div>
    </section>
  );
}

function UnitNode({
  node,
  org,
  selected,
  dim,
  onSelect,
}: {
  node: Node;
  org: OrgData;
  selected: boolean;
  dim: boolean;
  onSelect: (id: string) => void;
}) {
  const { unit, x, y, w, h, chip } = node;
  const leader = leaderOf(org, unit);
  const count = headcount(org, unit.id);
  const who = leader ? `${leader.display_name} ${leader.title ?? ""}`.trim() : "조직장 없음";
  const label = `${unit.name}, ${count}명, ${who}`;
  const common = {
    "data-node": true,
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    "aria-pressed": selected,
    className: `${s.node} ${s[unit.kind]} ${selected ? s.nodeOn : ""} ${dim ? s.dim : ""}`,
    onClick: () => onSelect(unit.id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(unit.id);
      }
    },
  };

  if (chip) {
    return (
      <g {...common}>
        <title>{`${unit.name} · 팀장 ${who}`}</title>
        <rect x={x} y={y} width={w} height={h} rx={h / 2} className={s.chip} />
        <text x={x + w / 2} y={y + h / 2 + 5} textAnchor="middle" className={s.chipText}>
          {unit.name} <tspan className={s.chipCount}>{count}</tspan>
        </text>
      </g>
    );
  }
  return (
    <g {...common}>
      <title>{label}</title>
      <rect x={x} y={y} width={w} height={h} rx={14} className={s.card} />
      <rect x={x + 9} y={y + 14} width={3} height={h - 28} rx={1.5} className={s.bar} />
      <text x={x + 22} y={y + 26} className={s.cardName}>
        {unit.name}
      </text>
      <text x={x + 22} y={y + 46} className={s.cardSub}>
        {who}
      </text>
      <text x={x + w - 12} y={y + 26} textAnchor="end" className={s.cardCount}>
        {count}명
      </text>
    </g>
  );
}
