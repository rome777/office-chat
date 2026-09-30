"use client";

// ② 캘린더 아래 목록 두 칸: 선택한 날짜의 일정 | 보고 있는 기간(이 달·이번 주·앞으로 7일)의 일정 목록.
// 한 줄(EventRow)은 대시보드에서도 쓸 수 있게 필요한 이름표를 모두 props 로 받는다.

import { HOLIDAYS, KIND_LABEL, colorVar, subtypeLabel } from "./kinds";
import { addDaysKey, daysOf, weekdayOf, type CalItem } from "./items";
import { formatKstTime, kstDateKey } from "./time";
import s from "./schedule.module.css";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
export const dayLabel = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일 (${DOW[weekdayOf(d)]})`;

export type RowNames = {
  rooms: ReadonlyMap<string, string>;
  units: ReadonlyMap<string, string>;
  channels: ReadonlyMap<string, string>;
  /** 팀원 일정의 담당자 이름 */
  people: ReadonlyMap<string, string>;
};

function timeText(it: CalItem): string {
  if (it.all_day) {
    const days = daysOf(it);
    if (days.length === 1) return "종일";
    const last = days[days.length - 1];
    const sameMonth = last.slice(0, 7) === days[0].slice(0, 7);
    return `${dayLabel(days[0]).replace(/ \(.\)$/, "")}~${sameMonth ? "" : `${Number(last.slice(5, 7))}월 `}${Number(last.slice(8))}일`;
  }
  const multi = kstDateKey(it.starts_at) !== kstDateKey(new Date(new Date(it.ends_at).getTime() - 1));
  return `${formatKstTime(it.starts_at)} – ${multi ? `${Number(kstDateKey(it.ends_at).slice(8))}일 ` : ""}${formatKstTime(it.ends_at)}`;
}

/** 분류 이름표: 팀이면 조직 이름, 프로젝트면 #채널. 팀원 일정은 비운다 (제목에 이름이 있다) */
export function categoryText(it: CalItem, names: RowNames): string {
  const e = it.event;
  if (!e) return "";
  if (e.category === "team") return (e.team_unit_id && names.units.get(e.team_unit_id)) || "팀 일정";
  if (e.category === "project") {
    const ch = e.channel_id ? names.channels.get(e.channel_id) : "";
    return ch ? `#${ch}` : "프로젝트 일정";
  }
  return "";
}

const VIS_TEXT: Record<string, string> = { time_only: "시간만 공개", private: "나만 보기" };

export function EventRow({ item, myId, names, onOpen }: { item: CalItem; myId: string; names: RowNames; onOpen: (item: CalItem) => void }) {
  const e = item.event;
  const t = item.team;
  const sub: string[] = [];
  let pending = false;
  let lock = "";
  if (t) {
    sub.push("팀 일정");
    if (t.location) sub.push(t.location);
    if (t.assignees?.length) sub.push(`담당 ${t.assignees.map((id) => names.people.get(id) ?? "팀원").join(", ")}`);
  } else if (e) {
    const where = e.room_id ? names.rooms.get(e.room_id) : e.location;
    if (where) sub.push(where);
    if (e.attendees.length > 1) {
      sub.push(
        e.kind === "work"
          ? `담당 ${e.attendees.length}명`
          : `참석 ${e.attendees.filter((a) => a.response === "accepted").length}/${e.attendees.length}`,
      );
    }
    if (e.recurrence) sub.push("반복");
    pending = e.attendees.some((a) => a.user_id === myId && a.response === "pending") && e.created_by !== myId;
    if (e.kind !== "meeting" && e.created_by === myId) lock = VIS_TEXT[e.visibility] ?? "";
  }
  const cat = categoryText(item, names);
  const typeLabel = t ? (t.kind ? KIND_LABEL[t.kind] : "바쁨") : e ? subtypeLabel(e.kind, e.subtype) || KIND_LABEL[e.kind] : "";
  return (
    <button type="button" className={`${s.row} ${item.canceled ? s.canceled : ""}`} onClick={() => onOpen(item)}>
      <span className={s.rowTime}>{timeText(item)}</span>
      <span>
        <span className={s.rowTitle}>
          <span className={s.tag} style={{ ["--c" as string]: colorVar(item.color) }}>
            {typeLabel}
          </span>
          {cat && (
            <span className={s.tag} style={{ ["--c" as string]: e?.category === "project" ? "var(--k-work)" : "var(--accent)" }}>
              {cat}
            </span>
          )}
          <span>{item.title}</span>
        </span>
        <span className={s.rowSub}>
          {sub.map((t) => (
            <span key={t}>{t}</span>
          ))}
          {lock && <span className={s.lockText}>{lock}</span>}
          {pending && <span className={s.warnText}>응답 전</span>}
          {item.canceled && <span className={s.badText}>취소됨</span>}
        </span>
      </span>
    </button>
  );
}

export default function EventLists({
  selected,
  today,
  byDay,
  rangeDays,
  rangeTitle,
  myId,
  names,
  onOpen,
  onCreate,
}: {
  selected: string;
  today: string;
  byDay: Map<string, CalItem[]>;
  /** 오른쪽 목록에 넣을 날짜들 */
  rangeDays: string[];
  rangeTitle: string;
  myId: string;
  names: RowNames;
  onOpen: (item: CalItem) => void;
  onCreate: (date: string) => void;
}) {
  const day = byDay.get(selected) ?? [];
  // 여러 날에 걸친 일정은 기간 목록에 첫날(또는 기간의 첫날)에만 한 번 넣는다
  const seen = new Set<string>();
  const groups = rangeDays
    .map((d) => {
      const list = (byDay.get(d) ?? []).filter((it) => {
        if (seen.has(it.key)) return false;
        seen.add(it.key);
        return true;
      });
      return { d, list };
    })
    .filter((g) => g.list.length);
  const total = groups.reduce((n, g) => n + g.list.length, 0);

  return (
    <div className={s.lists}>
      <section className={s.pane} aria-label="선택한 날짜의 일정">
        <div className={s.paneHead}>
          <h3>
            {dayLabel(selected)}
            {selected === today ? " · 오늘" : ""}
            {HOLIDAYS[selected] ? ` · ${HOLIDAYS[selected]}` : ""}
          </h3>
          <span className={s.count}>{day.length}건</span>
          <button type="button" className={s.small} onClick={() => onCreate(selected)}>
            + 이 날에 만들기
          </button>
        </div>
        <div className={s.paneBody}>
          {day.length ? (
            day.map((it) => <EventRow key={it.key} item={it} myId={myId} names={names} onOpen={onOpen} />)
          ) : (
            <p className={s.empty}>이 날은 일정이 없습니다. 날짜를 두 번 누르거나 [이 날에 만들기]로 추가합니다.</p>
          )}
        </div>
      </section>
      <section className={s.pane} aria-label={rangeTitle}>
        <div className={s.paneHead}>
          <h3>{rangeTitle}</h3>
          <span className={s.count}>{total}건</span>
        </div>
        <div className={s.paneBody}>
          {groups.length ? (
            groups.map((g) => (
              <div key={g.d}>
                <div className={`${s.listDate} ${g.d === today ? s.today : ""}`}>
                  {dayLabel(g.d)}
                  {g.d === today ? " · 오늘" : ""}
                </div>
                {g.list.map((it) => (
                  <EventRow key={it.key} item={it} myId={myId} names={names} onOpen={onOpen} />
                ))}
              </div>
            ))
          ) : (
            <p className={s.empty}>보이는 일정이 없습니다. 왼쪽 필터를 확인해 주세요.</p>
          )}
        </div>
      </section>
    </div>
  );
}

/** 보는 방식마다 오른쪽 목록의 날짜와 제목 */
export function rangeOf(view: "month" | "week" | "day", month: string, selected: string, monday: string): { days: string[]; title: string } {
  if (view === "month") {
    const days: string[] = [];
    for (let d = `${month}-01`; d.slice(0, 7) === month; d = addDaysKey(d, 1)) days.push(d);
    return { days, title: `${Number(month.slice(5))}월 일정 목록` };
  }
  if (view === "week") return { days: Array.from({ length: 7 }, (_, i) => addDaysKey(monday, i)), title: "이 주 일정 목록" };
  return { days: Array.from({ length: 7 }, (_, i) => addDaysKey(selected, i + 1)), title: "앞으로 7일" };
}
