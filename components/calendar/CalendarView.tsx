"use client";

// ② 캘린더 화면 (/calendar). 주간 보기 + 회의 만들기·상세 + 회의실 예약 현황.
// 회의 하나를 여는 주소는 /calendar?e=<회의 id> — 일정 알림(③)이 이 주소로 보낸다.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Room } from "@/lib/types/calendar";
import type { Person } from "@/lib/types/people";
import { getPeople, unknownPerson } from "@/components/people/directory";
import EventDetail from "./EventDetail";
import EventForm from "./EventForm";
import RoomBoard from "./RoomBoard";
import WeekGrid from "./WeekGrid";
import { getEvent, getMyId, listMyEvents, listRooms, type EventWithAttendees } from "./source";
import { addDays, formatKstDay, kstDateKey, startOfKstWeek, toMs } from "./time";
import s from "./calendar.module.css";

type Dialog = { kind: "create" } | { kind: "edit"; event: EventWithAttendees } | null;

export default function CalendarView() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("e");

  const [myId, setMyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfKstWeek(new Date()));
  const [rooms, setRooms] = useState<Room[]>([]);
  const [events, setEvents] = useState<EventWithAttendees[]>([]);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [opened, setOpened] = useState<EventWithAttendees | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [boardDate, setBoardDate] = useState(() => kstDateKey(new Date()));
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const fail = useCallback((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)), []);

  useEffect(() => {
    void getMyId().then(setMyId, fail);
    void listRooms().then(setRooms, fail);
  }, [fail]);

  // 다른 사람이 초대·수정·취소한 것은 실시간으로 오지 않으므로(일정 알림은 ③), 탭으로 돌아오면 다시 불러온다
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // 이번 주 회의
  useEffect(() => {
    let alive = true;
    void listMyEvents(weekStart, addDays(weekStart, 7)).then((list) => {
      if (!alive) return;
      setEvents(list);
      setLoadError(null);
    }, fail);
    return () => {
      alive = false;
    };
  }, [weekStart, version, fail]);

  // ?e= 로 연 회의. 참석자가 아니면 "찾을 수 없음"
  useEffect(() => {
    if (!openId) {
      setOpened(null);
      setNotFound(false);
      return;
    }
    let alive = true;
    void getEvent(openId).then((e) => {
      if (!alive) return;
      setOpened(e);
      setNotFound(!e);
      // 다른 주의 회의로 바로 들어온 경우 그 주를 보여 준다
      if (e) {
        setWeekStart((w) => {
          const at = toMs(e.starts_at);
          return at < w.getTime() || at >= addDays(w, 7).getTime() ? startOfKstWeek(e.starts_at) : w;
        });
      }
    }, fail);
    return () => {
      alive = false;
    };
  }, [openId, version, fail]);

  // 참석자 이름
  const attendeeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of [...events, ...(opened ? [opened] : [])]) {
      e.attendees.forEach((a) => ids.add(a.user_id));
    }
    return [...ids].sort().join(",");
  }, [events, opened]);
  useEffect(() => {
    if (!attendeeIds) return;
    let alive = true;
    void getPeople(attendeeIds.split(",")).then((list) => {
      if (alive) setPeople(new Map(list.map((p) => [p.id, p])));
    }, fail);
    return () => {
      alive = false;
    };
  }, [attendeeIds]);

  const openEvent = (id: string | null) =>
    router.replace(id ? `/calendar?e=${encodeURIComponent(id)}` : "/calendar", { scroll: false });

  const weekEnd = addDays(weekStart, 6);
  const thisWeek = startOfKstWeek(new Date()).getTime() === weekStart.getTime();

  return (
    <main className={s.page}>
      <header className={s.toolbar}>
        <Link href="/" className={s.back}>
          ← 채팅
        </Link>
        <h1>캘린더</h1>
        <div className={s.weekNav}>
          <button type="button" className={s.secondary} onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="이전 주">
            ‹
          </button>
          <button type="button" className={s.secondary} disabled={thisWeek} onClick={() => setWeekStart(startOfKstWeek(new Date()))}>
            이번 주
          </button>
          <button type="button" className={s.secondary} onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="다음 주">
            ›
          </button>
          <span className={s.weekLabel}>
            {formatKstDay(weekStart)} ~ {formatKstDay(weekEnd)}
          </span>
        </div>
        <button
          type="button"
          className={s.primary}
          disabled={!myId}
          onClick={() => setDialog({ kind: "create" })}
        >
          회의 만들기
        </button>
      </header>

      {loadError && (
        <p className={s.error} role="alert">
          캘린더를 불러오지 못했습니다: {loadError}
        </p>
      )}
      {events.length === 0 && !loadError && <p className={s.emptyWeek}>이번 주에 내 회의가 없습니다.</p>}
      <WeekGrid weekStart={weekStart} events={events} myId={myId ?? ""} onSelect={openEvent} />

      <RoomBoard rooms={rooms} date={boardDate} onDateChange={setBoardDate} version={version} />

      {notFound && (
        <div className={s.backdrop} onClick={() => openEvent(null)}>
          <section className={s.dialog} role="dialog" aria-modal="true" aria-label="회의 없음" onClick={(e) => e.stopPropagation()}>
            <h2>회의를 찾을 수 없습니다</h2>
            <p className="muted">지워졌거나, 초대받지 않은 회의입니다.</p>
            <div className={s.actions}>
              <button type="button" className={s.secondary} onClick={() => openEvent(null)}>
                닫기
              </button>
            </div>
          </section>
        </div>
      )}

      {opened && myId && !dialog && (
        <EventDetail
          event={opened}
          rooms={rooms}
          people={people}
          myId={myId}
          onClose={() => openEvent(null)}
          onEdit={() => setDialog({ kind: "edit", event: opened })}
          onChanged={refresh}
        />
      )}

      {dialog && myId && (
        <EventForm
          rooms={rooms}
          myId={myId}
          editing={dialog.kind === "edit" ? dialog.event : undefined}
          // 참석자 id 를 기준으로 만든다 (이름을 아직 못 불러온 사람도 빠지지 않게)
          initialAttendees={
            dialog.kind === "edit"
              ? dialog.event.attendees
                  .filter((a) => a.user_id !== myId)
                  .map((a) => people.get(a.user_id) ?? unknownPerson(a.user_id))
              : []
          }
          defaultDate={thisWeek ? kstDateKey(new Date()) : kstDateKey(weekStart)}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            setDialog(null);
            refresh();
            openEvent(id);
          }}
        />
      )}
    </main>
  );
}
