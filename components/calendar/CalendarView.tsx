"use client";

// ② 일정 화면 (/calendar, 2026-09-30 개편). 서브 메뉴 칸 | 큰 캘린더(월·주·일) + 아래 목록 두 칸.
// 일정 상세·만들기·고치기는 공통 틀의 오른쪽 패널에 연다 (RightPanel → EventPanel·EventEditor).
// 주소:
//   /calendar?e=<일정 id>        그 일정의 상세를 연다 (일정 알림 ③ 이 이 주소로 보낸다)
//   /calendar?new=1&with=<사람>   일정 만들기를 그 사람을 참석자로 넣어 연다 (대시보드·프로필 카드의 "일정 잡기")
//   /calendar#rooms               회의실 예약(/rooms)으로 넘긴다 (예전 주소)
// 보이는 것은 내가 만들었거나 초대받은 일정 + 같은 부서 팀원이 공개 범위만큼 보여 준 일정뿐이다 (DB 가 지킨다).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TeamEvent } from "@/lib/types/calendar";
import { getPeople } from "@/components/people/directory";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import CalendarNav from "./CalendarNav";
import EventLists, { rangeOf, type RowNames } from "./EventLists";
import MonthGrid from "./MonthGrid";
import TimeGrid from "./TimeGrid";
import { focusCalendarDate, useCalendarFocus, useCalendarVersion } from "./calendarBus";
import {
  DEFAULT_FILTERS,
  addDaysKey,
  addMonthKey,
  byDay as groupByDay,
  dayStart,
  eventItem,
  mondayOf,
  monthGrid,
  passes,
  teamItem,
  type CalItem,
  type Filters,
} from "./items";
import { getCategoryNames, getEvent, getMyId, listMyEvents, listRooms, listTeamEvents, type EventWithAttendees } from "./source";
import { kstDateKey } from "./time";
import s from "./schedule.module.css";

type View = "month" | "week" | "day";
const VIEW_KEY = "workon.calendar.view";
const FILTER_KEY = "workon.calendar.filters";

function readStored<T>(key: string, fallback: T, ok: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v !== null && ok(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 창)면 이번 화면에서만 기억한다
  }
}

export default function CalendarView() {
  const router = useRouter();
  const params = useSearchParams();
  const { openPanel } = useWorkspace();
  const [today, setToday] = useState(() => kstDateKey(new Date()));

  const [myId, setMyId] = useState<string | null>(null);
  const [view, setViewState] = useState<View>("month");
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [events, setEvents] = useState<EventWithAttendees[]>([]);
  const [teamEvents, setTeamEvents] = useState<TeamEvent[]>([]);
  const [names, setNames] = useState<RowNames>({ rooms: new Map(), units: new Map(), channels: new Map(), people: new Map() });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState(0);
  const version = useCalendarVersion();
  const focus = useCalendarFocus();

  // 보는 방식·필터는 이 브라우저에 기억한다 (처음 그림은 기본값 — 서버 그림과 같게)
  useEffect(() => {
    setViewState(readStored<View>(VIEW_KEY, "month", (v) => v === "month" || v === "week" || v === "day"));
    setFiltersState(
      readStored<Filters>(FILTER_KEY, DEFAULT_FILTERS, (v) => typeof v === "object" && v !== null && "cats" in v && "types" in v),
    );
  }, []);
  const setView = (v: View) => {
    setViewState(v);
    store(VIEW_KEY, v);
    if (v === "month") setMonth(selected.slice(0, 7));
  };
  const setFilters = (f: Filters) => {
    setFiltersState(f);
    store(FILTER_KEY, f);
  };

  const select = useCallback((d: string) => {
    setSelected(d);
    setMonth(d.slice(0, 7));
  }, []);

  useEffect(() => {
    void getMyId().then(setMyId, (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
    void listRooms().then(
      (rooms) => setNames((n) => ({ ...n, rooms: new Map(rooms.map((r) => [r.id, r.name])) })),
      () => {},
    );
  }, []);

  // 다른 사람이 초대·수정·취소한 것은 실시간으로 오지 않으므로(일정 알림은 ③), 탭으로 돌아오면 다시 불러온다
  useEffect(() => {
    // 켜 둔 채 자정이 지나면 "오늘"도 다시 정한다
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setLocalVersion((v) => v + 1);
      setToday(kstDateKey(new Date()));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // 패널에서 저장한 일정의 날짜로 옮긴다. 화면을 열기 전에 남아 있던 것은 따르지 않는다 (다른 화면에 다녀오면 오늘로 열리게)
  const [focusSeen] = useState(() => focus?.seq ?? 0);
  useEffect(() => {
    if (focus && focus.seq > focusSeen) select(focus.date);
  }, [focus, focusSeen, select]);

  // 불러올 기간: 미니 캘린더·월 보기의 달 격자 + 주·일 보기와 오른쪽 목록이 쓰는 날짜
  const monday = mondayOf(selected);
  const grid = monthGrid(month);
  const viewFrom = view === "month" ? grid.first : view === "week" ? monday : selected;
  const viewTo = view === "month" ? addDaysKey(grid.last, 1) : view === "week" ? addDaysKey(monday, 7) : addDaysKey(selected, 8);
  const from = viewFrom < grid.first ? viewFrom : grid.first;
  const to = viewTo > addDaysKey(grid.last, 1) ? viewTo : addDaysKey(grid.last, 1);

  useEffect(() => {
    let alive = true;
    const a = dayStart(from);
    const b = dayStart(to);
    void Promise.all([
      listMyEvents(a, b),
      listTeamEvents(a, b).then(
        (t) => (setTeamError(null), t),
        (e: unknown) => (setTeamError(e instanceof Error ? e.message : String(e)), [] as TeamEvent[]),
      ),
    ]).then(
      async ([list, team]) => {
        if (!alive) return;
        setEvents(list);
        setTeamEvents(team);
        setLoadError(null);
        const unitIds = [...new Set(list.map((e) => e.team_unit_id).filter((v): v is string => !!v))];
        const channelIds = [...new Set(list.map((e) => e.channel_id).filter((v): v is string => !!v))];
        const [cat, people] = await Promise.all([
          getCategoryNames(unitIds, channelIds).catch(() => ({ units: new Map<string, string>(), channels: new Map<string, string>() })),
          team.length ? getPeople([...new Set(team.flatMap((t) => [t.user_id, ...(t.assignees ?? [])]))]).catch(() => []) : Promise.resolve([]),
        ]);
        if (!alive) return;
        setNames((n) => ({ ...n, units: cat.units, channels: cat.channels, people: new Map(people.map((p) => [p.id, p.display_name])) }));
      },
      (e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [from, to, version, localVersion]);

  // ?e= · ?new=1 · #rooms 를 한 번 처리하고 주소에서 지운다 (새로고침해도 다시 열리지 않게)
  const openId = params.get("e");
  const wantNew = params.get("new") === "1";
  const withId = params.get("with");
  useEffect(() => {
    if (window.location.hash === "#rooms") {
      router.replace(wantNew ? "/rooms?new=1" : "/rooms");
      return;
    }
    if (!openId && !wantNew) return;
    router.replace("/calendar", { scroll: false });
    if (openId) {
      openPanel({ kind: "event", eventId: openId });
      void getEvent(openId).then((e) => e && focusCalendarDate(kstDateKey(e.starts_at)), () => {});
    } else {
      openPanel({ kind: "eventNew", date: kstDateKey(new Date()), withIds: withId ? [withId] : [] });
    }
  }, [openId, wantNew, withId, router, openPanel]);

  const items = useMemo(() => {
    const all: CalItem[] = [
      ...events.map(eventItem),
      ...teamEvents.map((t) => teamItem(t, names.people.get(t.user_id) ?? "팀원")),
    ];
    return all.filter((it) => passes(it, filters));
  }, [events, teamEvents, names.people, filters]);
  const byDay = useMemo(() => groupByDay(items), [items]);
  const marked = useMemo(() => new Set(byDay.keys()), [byDay]);

  const onOpen = (it: CalItem) => {
    if (it.event) openPanel({ kind: "event", eventId: it.event.id });
    else if (it.team) {
      const t = it.team;
      openPanel({
        kind: "teamEvent",
        name: t.name,
        userId: t.user_id,
        eventKind: t.kind,
        label: t.label,
        title: t.title,
        location: t.location,
        assignees: (t.assignees ?? []).map((id) => names.people.get(id) ?? "팀원"),
        startsAt: t.starts_at,
        endsAt: t.ends_at,
        allDay: t.all_day,
      });
    }
  };
  const onCreate = (date: string, time?: string) => {
    select(date);
    openPanel({ kind: "eventNew", date, time });
  };

  const move = (n: number) => {
    if (view === "month") {
      const next = addMonthKey(month, n);
      setMonth(next);
      setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
    } else select(addDaysKey(selected, view === "week" ? 7 * n : n));
  };

  const label =
    view === "month"
      ? `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`
      : view === "week"
        ? `${Number(monday.slice(5, 7))}월 ${Number(monday.slice(8))}일 ~ ${Number(addDaysKey(monday, 6).slice(5, 7))}월 ${Number(addDaysKey(monday, 6).slice(8))}일`
        : `${selected.slice(0, 4)}년 ${Number(selected.slice(5, 7))}월 ${Number(selected.slice(8))}일`;
  const range = rangeOf(view, month, selected, monday);
  const onToday = view === "month" ? month === today.slice(0, 7) && selected === today : selected === today;

  return (
    <div className={s.page}>
      <CalendarNav
        month={month}
        selected={selected}
        today={today}
        marked={marked}
        filters={filters}
        onFilters={setFilters}
        onSelect={select}
        onMonthChange={setMonth}
        onCreate={() => onCreate(selected)}
      />
      <section className={s.body} aria-label="일정 캘린더">
        <div className={s.toolbar}>
          <button type="button" className={s.secondary} disabled={onToday} onClick={() => select(today)}>
            오늘
          </button>
          <button type="button" className={s.iconButton} aria-label="이전" onClick={() => move(-1)}>
            ‹
          </button>
          <button type="button" className={s.iconButton} aria-label="다음" onClick={() => move(1)}>
            ›
          </button>
          <h1 className={s.label}>{label}</h1>
          <div className={s.seg} role="group" aria-label="보기">
            {(
              [
                ["month", "월"],
                ["week", "주"],
                ["day", "일"],
              ] as const
            ).map(([v, t]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {loadError && (
          <p className={s.loadError} role="alert">
            일정을 불러오지 못했습니다: {loadError}
          </p>
        )}
        {teamError && !loadError && (
          <p className={s.loadError} role="alert">
            팀원 일정을 불러오지 못했습니다 (내 일정은 보입니다): {teamError}
          </p>
        )}
        {view === "month" ? (
          <MonthGrid month={month} selected={selected} today={today} days={byDay} onSelect={select} onCreate={onCreate} onOpen={onOpen} />
        ) : (
          <TimeGrid
            days={view === "week" ? Array.from({ length: 7 }, (_, i) => addDaysKey(monday, i)) : [selected]}
            byDay={byDay}
            selected={selected}
            today={today}
            myId={myId ?? ""}
            onSelect={select}
            onCreate={onCreate}
            onOpen={onOpen}
          />
        )}
        <EventLists
          selected={selected}
          today={today}
          byDay={byDay}
          rangeDays={range.days}
          rangeTitle={range.title}
          myId={myId ?? ""}
          names={names}
          onOpen={onOpen}
          onCreate={(d) => onCreate(d)}
        />
      </section>
    </div>
  );
}
