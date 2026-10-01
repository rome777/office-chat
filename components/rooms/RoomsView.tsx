"use client";

// ② 회의실 예약 (/rooms, 2026-10-01 개편 WU-46). 일정 화면과 같은 틀:
//   서브 메뉴(RoomsNav: 만들기·미니 캘린더·인원/층/시설 필터) | 본문(툴바 회의실/시간표 → RoomCards·RoomTimetable, 아래 MyBookings)
//   | 공통 틀의 오른쪽 패널(roomBook = 예약·고치기, roomSlot = 남의 예약, event = 내 예약 상세)
// 흐름: 예약 현황(카드) → 빈 시간(시간표) → 예약 등록(패널) → 내 예약 관리. 시간표 칸과 예약 패널의 회의실·날짜·시각은
//   패널 상태(PanelState roomBook) 하나를 같이 본다 — 패널이 열린 채 다른 빈 칸을 누르면 패널이 따라 바뀐다.
// 예약 규칙은 DB 트리거가 막고(components/rooms/policy.ts 와 같은 숫자), 남의 예약은 room_board 가 준 만큼만 보인다.
// 주소: /rooms?date=YYYY-MM-DD 그 날짜로 · /rooms?new=1 예약 패널을 바로 연다 (대시보드 빠른 실행 "회의실")

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CalendarEvent, Room, RoomBooking } from "@/lib/types/calendar";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { cachedRooms } from "@/components/calendar/EventPanel";
import { useCalendarFocus, useCalendarVersion } from "@/components/calendar/calendarBus";
import { addDaysKey } from "@/components/calendar/items";
import { listMyRoomBookings, roomBoard } from "@/components/calendar/source";
import { addDays, formatKstDay, fromKstInput, kstDateKey, kstMinuteOfDay, toMs } from "@/components/calendar/time";
import cal from "@/components/calendar/schedule.module.css";
import MyBookings from "./MyBookings";
import RoomCards from "./RoomCards";
import RoomsNav, { DEFAULT_ROOM_FILTERS, floorsOf, type RoomFilters } from "./RoomsNav";
import RoomTimetable from "./RoomTimetable";
import { ROOM_POLICY, bookingWindow, hm, nowSlot, toMin } from "./policy";
import { amIAdmin } from "./source";
import { roomState } from "./status";
import s from "./rooms.module.css";

type View = "cards" | "grid";
const VIEW_KEY = "workon.rooms.view";
const FILTER_KEY = "workon.rooms.filters";
const RELOAD_MS = 5 * 60_000; // 남이 새로 잡은 예약을 받아 오는 간격 (탭이 보일 때만)
const TICK_MS = 30_000; // 상태·지금 선을 다시 그리는 간격

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
    // 저장이 막힌 브라우저면 이번 화면에서만 기억한다
  }
}
const isDateKey = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const overlaps = (b: RoomBooking, date: string, start: number, end: number) =>
  toMs(b.starts_at) < fromKstInput(date, hm(end)).getTime() && toMs(b.ends_at) > fromKstInput(date, hm(start)).getTime();

export default function RoomsView() {
  const router = useRouter();
  const params = useSearchParams();
  const { panel, openPanel } = useWorkspace();
  const version = useCalendarVersion();
  const focus = useCalendarFocus();

  const [now, setNow] = useState(() => Date.now());
  const { today, lastDay } = bookingWindow(new Date(now));
  const [date, setDateState] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setViewState] = useState<View>("cards");
  const [filters, setFiltersState] = useState<RoomFilters>(DEFAULT_ROOM_FILTERS);
  const [focusRoom, setFocusRoom] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [board, setBoard] = useState<RoomBooking[] | null>(null);
  const [boardFor, setBoardFor] = useState<string | null>(null);
  const [mine, setMine] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const visibleRef = useRef<Room[]>([]);
  const [pendingNew, setPendingNew] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    void amIAdmin().then(setAdmin);
  }, []);

  const setDate = useCallback((d: string) => {
    setDateState(d);
    setMonth(d.slice(0, 7));
  }, []);

  // 보기·필터는 이 브라우저에 기억한다 (처음 그림은 기본값 — 서버 그림과 같게)
  useEffect(() => {
    setViewState(readStored<View>(VIEW_KEY, "cards", (v) => v === "cards" || v === "grid"));
    setFiltersState(readStored<RoomFilters>(FILTER_KEY, DEFAULT_ROOM_FILTERS, (v) => typeof v === "object" && v !== null && "cap" in v && "fac" in v));
  }, []);
  const setView = (v: View) => {
    setViewState(v);
    store(VIEW_KEY, v);
  };
  const setFilters = (f: RoomFilters) => {
    setFiltersState(f);
    store(FILTER_KEY, f);
  };

  useEffect(() => {
    void cachedRooms().then(setRooms, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // 그날 모든 회의실의 예약 (한 번에)
  useEffect(() => {
    let alive = true;
    const from = fromKstInput(date, "00:00");
    void roomBoard(from, addDays(from, 1)).then(
      (rows) => {
        if (!alive) return;
        setBoard(rows);
        setBoardFor(date);
        setError(null);
      },
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [date, version, reload]);

  // 내 예약: 지난 30일 ~ 예약할 수 있는 마지막 날
  useEffect(() => {
    let alive = true;
    void listMyRoomBookings(fromKstInput(addDaysKey(today, -30), "00:00"), fromKstInput(addDaysKey(lastDay, 1), "00:00")).then(
      (rows) => {
        if (!alive) return;
        setMine(rows);
        setMineError(null);
      },
      (e: unknown) => alive && setMineError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [today, lastDay, version, reload]);

  // 켜 둔 채 시간이 흐르면 상태·지금 선을 다시 그리고, 탭이 보일 때 5분마다(또는 돌아올 때) 다시 불러온다
  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const onVisible = () => {
      if (!visible()) return;
      setNow(Date.now());
      setReload((n) => n + 1);
    };
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    const again = setInterval(() => visible() && setReload((n) => n + 1), RELOAD_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      clearInterval(again);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // 예약 패널의 날짜를 바꾸거나, 패널에서 저장한 예약의 날짜로 본문을 옮긴다
  const book = panel?.kind === "roomBook" ? panel : null;
  const bookDate = book?.date;
  useEffect(() => {
    if (isDateKey(bookDate ?? null)) setDate(bookDate!);
  }, [bookDate, setDate]);
  // 일정 패널에서 저장하면 그 날짜로 (들어오기 전에 일정 화면에서 남긴 값은 무시)
  const seenFocus = useRef(focus?.seq ?? 0);
  useEffect(() => {
    if (!focus || focus.seq <= seenFocus.current) return;
    seenFocus.current = focus.seq;
    setDate(focus.date);
  }, [focus, setDate]);

  const roomList = useMemo(() => rooms ?? [], [rooms]);
  const roomMap = useMemo(() => new Map(roomList.map((r) => [r.id, r])), [roomList]);
  const dayBoard = useMemo(() => (board && boardFor === date ? board : []), [board, boardFor, date]);
  const canBook = date >= today && date <= lastDay;

  /** 회의실의 [start, end) 가 비었나 (고치는 중인 내 예약 자리는 빈 것으로 본다) */
  const isFree = useCallback(
    (roomId: string, start: number, end: number) =>
      !dayBoard.some((b) => b.room_id === roomId && !(book?.eventId && b.event_id === book.eventId) && overlaps(b, date, start, end)),
    [dayBoard, book?.eventId, date],
  );
  /** 처음 비는 시작 분 (오늘이면 지금 칸부터, 다른 날이면 10시부터) */
  const nextFree = useCallback(
    (roomId: string) => {
      const from = date === today ? Math.max(ROOM_POLICY.open, nowSlot(new Date(now))) : ROOM_POLICY.open + 120;
      for (let m = from; m + ROOM_POLICY.slot <= ROOM_POLICY.close; m += ROOM_POLICY.slot) if (isFree(roomId, m, m + ROOM_POLICY.slot)) return m;
      if (date !== today) for (let m = ROOM_POLICY.open; m < from; m += ROOM_POLICY.slot) if (isFree(roomId, m, m + ROOM_POLICY.slot)) return m;
      return null;
    },
    [date, today, now, isFree],
  );
  /** start 부터 최대 1시간, 다음 예약 전까지 */
  const spanFrom = useCallback(
    (roomId: string, start: number) => {
      let end = start + ROOM_POLICY.slot;
      while (end < start + 60 && end + ROOM_POLICY.slot <= ROOM_POLICY.close && isFree(roomId, start, end + ROOM_POLICY.slot)) end += ROOM_POLICY.slot;
      return end;
    },
    [isFree],
  );

  const openBook = useCallback(
    (roomId: string, start: number, end: number, eventId?: string) =>
      openPanel({ kind: "roomBook", roomId, date, start: hm(start), end: hm(end), ...(eventId ? { eventId } : {}) }),
    [openPanel, date],
  );

  // /rooms?new=1 · ?date= — 읽고 주소에서 지운다
  useEffect(() => {
    const d = params.get("date");
    const wantNew = params.get("new") === "1";
    if (!isDateKey(d) && !wantNew) return;
    if (isDateKey(d)) setDate(d);
    router.replace("/rooms", { scroll: false });
    if (wantNew) setPendingNew(true);
  }, [params, router, setDate]);

  /** [+ 회의실 예약]: 필터에 맞는 회의실 중 처음 비는 곳, 없으면 아무 회의실 (예약할 수 없는 날이면 오늘로) */
  const createAny = useCallback(() => {
    setNotice(null);
    if (!canBook) {
      setDate(today);
      setPendingNew(true);
      return;
    }
    for (const list of [visibleRef.current, roomList]) {
      for (const r of list) {
        const m = nextFree(r.id);
        if (m !== null) return openBook(r.id, m, spanFrom(r.id, m));
      }
    }
    setNotice("이 날짜에는 남은 빈 시간이 있는 회의실이 없습니다. 다른 날짜를 골라 주세요.");
  }, [canBook, today, roomList, nextFree, spanFrom, openBook, setDate]);
  useEffect(() => {
    if (!pendingNew || !rooms || boardFor !== date) return;
    setPendingNew(false);
    createAny();
  }, [pendingNew, rooms, boardFor, date, createAny]);

  // 시간표 빈 칸: 패널이 열려 있으면 같은 줄은 늘리거나 줄이고, 다른 줄이면 회의실을 옮긴다 (관리자는 4시간 넘게)
  const maxLen = admin ? ROOM_POLICY.close - ROOM_POLICY.open : ROOM_POLICY.maxMinutes;
  function pickCell(roomId: string, m: number) {
    setNotice(null);
    setFocusRoom(null);
    const editing = book?.eventId ? mine?.find((e) => e.id === book.eventId) : undefined;
    const running = !!editing && toMs(editing.starts_at) <= now;
    if (book && book.date === date && book.roomId === roomId) {
      const start = toMin(book.start);
      if (m >= start) {
        if (m + ROOM_POLICY.slot - start <= maxLen && isFree(roomId, start, m + ROOM_POLICY.slot)) {
          openPanel({ ...book, end: hm(m + ROOM_POLICY.slot) });
        }
        return;
      }
      if (!running && isFree(roomId, m, toMin(book.end)) && toMin(book.end) - m <= maxLen) {
        openPanel({ ...book, start: hm(m) });
        return;
      }
    }
    if (running) return; // 진행 중인 예약은 시작·회의실을 옮기지 않는다 (종료만)
    openBook(roomId, m, spanFrom(roomId, m), book?.eventId);
  }

  function openBooking(b: RoomBooking) {
    if (b.event_id) {
      openPanel({ kind: "event", eventId: b.event_id });
      return;
    }
    openPanel({
      kind: "roomSlot",
      roomId: b.room_id,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      isPrivate: b.is_private || !b.booker_name,
      bookerId: b.booker_id,
      bookerName: b.booker_name,
      bookerUnit: b.booker_unit,
    });
  }

  const visible = roomList.filter((r) => {
    if (filters.cap && (r.capacity ?? 0) < filters.cap) return false;
    if (filters.hideFloors.includes(r.location ?? "기타")) return false;
    if (!filters.fac.every((f) => r.facilities.includes(f))) return false;
    if (filters.freeNow && date === today) {
      const tone = roomState(dayBoard.filter((b) => b.room_id === r.id), date, today, now).tone;
      if (tone === "bad" || tone === "idle") return false;
    }
    return true;
  });
  visibleRef.current = visible;
  const marked = useMemo(() => new Set((mine ?? []).filter((e) => !e.canceled_at).map((e) => kstDateKey(e.starts_at))), [mine]);
  const availableNow = roomList.filter((r) => roomState(dayBoard.filter((b) => b.room_id === r.id), today, today, now).tone === "ok").length;
  const selection = book && book.date === date ? { roomId: book.roomId, start: toMin(book.start), end: toMin(book.end) } : null;
  const openEvent = panel?.kind === "event" ? panel.eventId : null;
  const nowMin = kstMinuteOfDay(new Date(now));

  return (
    <div className={cal.page}>
      <RoomsNav
        rooms={roomList}
        month={month}
        selected={date}
        today={today}
        marked={marked}
        filters={filters}
        onFilters={setFilters}
        onSelect={setDate}
        onMonthChange={setMonth}
        onCreate={createAny}
      />
      <section className={cal.body} aria-label="회의실 예약 현황">
        <div className={cal.toolbar}>
          <button type="button" className={cal.secondary} disabled={date === today} onClick={() => setDate(today)}>
            오늘
          </button>
          <button type="button" className={cal.iconButton} aria-label="전날" onClick={() => setDate(addDaysKey(date, -1))}>
            ‹
          </button>
          <button type="button" className={cal.iconButton} aria-label="다음 날" onClick={() => setDate(addDaysKey(date, 1))}>
            ›
          </button>
          <h1 className={cal.label}>{formatKstDay(fromKstInput(date, "12:00"))}</h1>
          <span className={s.summary}>
            {date === today
              ? nowMin >= ROOM_POLICY.close
                ? "오늘 운영 종료"
                : board
                  ? `지금 ${availableNow}곳 사용 가능 · ${hm(nowMin)} 기준`
                  : ""
              : date > lastDay
                ? `${ROOM_POLICY.windowDays}일 뒤라 아직 예약할 수 없습니다`
                : date < today
                  ? "지난 날짜 (예약할 수 없음)"
                  : ""}
          </span>
          <div className={cal.seg} role="group" aria-label="보기">
            <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
              회의실
            </button>
            <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
              시간표
            </button>
          </div>
        </div>
        {error && (
          <p className={cal.loadError} role="alert">
            회의실 예약 현황을 불러오지 못했습니다: {error}
          </p>
        )}
        {notice && (
          <p className={cal.loadError} role="status">
            {notice}
          </p>
        )}

        <div className={s.view}>
          {rooms === null ? (
            <p className={s.empty}>불러오는 중…</p>
          ) : roomList.length === 0 ? (
            <p className={s.empty}>등록된 회의실이 없습니다. 회의실은 관리자가 넣습니다.</p>
          ) : visible.length === 0 ? (
            <p className={s.empty}>
              조건에 맞는 회의실이 없습니다.{" "}
              <button type="button" className={cal.small} onClick={() => setFilters(DEFAULT_ROOM_FILTERS)}>
                필터 지우기
              </button>
            </p>
          ) : view === "cards" ? (
            <>
              <p className={s.viewNote}>
                {visible.length} / {roomList.length}개 · {date === today ? "지금 상태와 다음 예약" : "그날 예약"}
              </p>
              <RoomCards
                rooms={visible}
                floors={floorsOf(roomList)}
                board={dayBoard}
                date={date}
                today={today}
                now={now}
                canBook={canBook}
                pickedRoom={selection?.roomId ?? null}
                nextFree={nextFree}
                onBook={(roomId, nowSlotOnly) => {
                  const m = nowSlotOnly ? nowSlot(new Date(now)) : nextFree(roomId);
                  if (m !== null) openBook(roomId, m, spanFrom(roomId, m), undefined);
                }}
                onTimetable={(roomId) => {
                  setFocusRoom(roomId);
                  setView("grid");
                }}
              />
            </>
          ) : (
            <>
              <div className={s.legend} aria-hidden="true">
                <span>
                  <i style={{ background: "var(--idle-soft)", borderLeft: "3px solid var(--idle)" }} />
                  예약됨 (예약자)
                </span>
                <span>
                  <i style={{ background: "repeating-linear-gradient(135deg, var(--idle-soft) 0 4px, var(--surface) 4px 8px)", borderLeft: "3px dashed var(--idle)" }} />
                  비공개 예약
                </span>
                <span>
                  <i style={{ background: "color-mix(in srgb, var(--accent) 18%, var(--surface))", borderLeft: "3px solid var(--accent)" }} />
                  내 예약
                </span>
                <span>
                  <i style={{ background: "repeating-linear-gradient(135deg, var(--border) 0 3px, transparent 3px 7px)" }} />
                  예약할 수 없는 시간
                </span>
              </div>
              <RoomTimetable
                rooms={visible}
                board={dayBoard}
                date={date}
                today={today}
                now={now}
                lastDay={lastDay}
                selection={selection}
                skipEventId={book?.eventId ?? null}
                focusRoom={focusRoom}
                focusEvent={openEvent}
                onCell={pickCell}
                onBooking={openBooking}
              />
              <p className={s.viewNote}>
                {selection
                  ? "같은 줄의 다른 빈 칸을 누르면 거기까지 늘어나거나 줄어듭니다 (최대 4시간). 다른 줄을 누르면 회의실이 바뀝니다."
                  : canBook
                    ? "빈 칸을 누르면 오른쪽에 예약 패널이 열립니다 (1시간)."
                    : "이 날짜는 예약할 수 없습니다 (오늘부터 90일까지)."}
              </p>
            </>
          )}
        </div>

        <MyBookings
          events={mine}
          rooms={roomMap}
          now={now}
          current={openEvent}
          error={mineError}
          onOpen={(e) => {
            setDate(kstDateKey(e.starts_at));
            openPanel({ kind: "event", eventId: e.id });
          }}
        />
      </section>
    </div>
  );
}
