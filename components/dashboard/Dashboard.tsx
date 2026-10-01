"use client";

// 대시보드 (/, 로그인 뒤 첫 화면, 2026-09-30 WU-35 · 2026-10-01 개편 WU-45).
// 정보 우선순위대로 위에서 아래로: 인사말(내 상태·다음 일정) → 요약 카드 4개(오늘의 일정·안 읽은 메시지·내 회의 예약·내 할 일)
// → 오늘의 일정(전체 폭, 지난 일정은 접음) → 빠른 실행(버튼 줄) → 내 할 일 | 회의실 현황 → 최근 대화.
// 내 할 일 (WU-47): 맨 위 "일정 초대 응답 필요 N건" 묶음([참석]·[불참]) + 할 일(todos)과 7일 안 업무 유형 일정을 기한순으로 섞은 한 목록.
// 새 표는 없다. 쓰는 것은 할 일 끝냄(done_at)과 일정 초대 응답(respond)뿐. 누르면 해당 화면으로 주소 이동 (/chat?c=, /chat?m=, /calendar?e=).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Room } from "@/lib/types/calendar";
import { showMentions } from "@/lib/mentions";
import { colorVar, KIND_LABEL, subtypeLabel } from "@/components/calendar/kinds"; // ② 일정 유형 이름·색 (2026-10-01)
import { listMyEvents, listRooms, respond, type EventWithAttendees } from "@/components/calendar/source";
import { addDays, formatKstTime, kstDateKey, startOfKstDay } from "@/components/calendar/time";
import { useSelf } from "@/components/chat/useSelf";
import { useMentionLabels } from "@/components/people/directory";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { STATUS_LABEL, useMyProfile } from "@/components/profile/profileSource";
import NewDmDialog from "@/components/sidebar/NewDmDialog";
import { getUnread } from "@/components/sidebar/unread";
import { useMyChannels, useMyDms, useUnread } from "@/components/sidebar/useChannels";
import { CalendarIcon, ChatIcon, CheckIcon, ChevronIcon, HashIcon, PlusIcon, RoomIcon } from "@/components/shell/icons";
import { useUnreadTotals } from "@/components/shell/useUnreadTotals";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import RoomStatus, { type MyMeeting } from "./RoomStatus";
import { finishTodo, listMyTodos, listPendingInvites, listRecent, type MyTodo, type PendingInvite, type Recent } from "./source";
import s from "./dashboard.module.css";

const RECENT = 6;
const TODO_SHOWN = 5; // 할 일은 이만큼만 펼치고 나머지는 [더 보기]
const WORK_DAYS = 7; // 업무 유형 일정은 오늘부터 이 날수 안의 것만 할 일에 끌어온다

function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }).format(now));
  if (h < 11) return "좋은 아침입니다";
  if (h < 17) return "좋은 오후입니다";
  return "좋은 저녁입니다";
}

const todayLabel = (now: Date) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" }).format(now);

function when(iso: string) {
  const d = new Date(iso);
  return kstDateKey(d) === kstDateKey(new Date())
    ? formatKstTime(d)
    : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(d);
}

/** "2026-10-03" 두 개의 날짜 차이 (b - a, 일) */
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** 할 일 기한 표시. tone 이 있으면 칩, 없으면 글자만 */
function dueOf(due: string | null, todayKey: string): { text: string; tone: "bad" | "warn" | null } {
  if (due === null) return { text: "기한 없음", tone: null };
  const d = dayDiff(todayKey, due);
  if (d < 0) return { text: `${-d}일 지남`, tone: "bad" };
  if (d === 0) return { text: "오늘 마감", tone: "warn" };
  if (d === 1) return { text: "내일 마감", tone: "warn" }; // 카드의 "마감 임박"(내일까지)과 같은 기준
  return { text: `${Number(due.slice(5, 7))}월 ${Number(due.slice(8, 10))}일 마감`, tone: null };
}

/** "10월 3일 (금) 14:00", 종일이면 시각 없이 */
const longWhen = (iso: string, allDay: boolean) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    ...(allDay ? {} : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  }).format(new Date(iso));

/** 업무 일정의 기한 칩 — 진행 중·오늘·내일은 색, 그 뒤는 D-n */
function workDue(e: EventWithAttendees, todayKey: string, nowMs: number): { text: string; tone: "ok" | "warn" | null } {
  const start = new Date(e.starts_at).getTime();
  if (!e.all_day && start <= nowMs) return { text: "진행 중", tone: "ok" };
  const d = dayDiff(todayKey, kstDateKey(e.starts_at));
  if (d <= 0) return { text: e.all_day ? "오늘" : `오늘 ${formatKstTime(e.starts_at)}`, tone: "warn" };
  if (d === 1) return { text: "내일", tone: "warn" };
  return { text: `D-${d}`, tone: null };
}

/** 할 일 목록 한 줄 — todos 또는 업무 유형 일정. date 는 정렬 기준 날짜(없으면 맨 뒤) */
type Item = { key: string; date: string | null; at: string; todo?: MyTodo; work?: EventWithAttendees };

export default function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, setChannel } = useWorkspace();
  const self = useSelf();
  const { profile } = useMyProfile();
  const { channels } = useMyChannels();
  const { dms } = useMyDms();
  const unread = useUnreadTotals();
  const labels = useMentionLabels();
  const [now, setNow] = useState(() => new Date());
  const [events, setEvents] = useState<EventWithAttendees[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [todos, setTodos] = useState<MyTodo[] | null>(null);
  const [work, setWork] = useState<EventWithAttendees[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[] | null>(null);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dmOpen, setDmOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [allTodos, setAllTodos] = useState(false);
  const fail = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []);

  // 예전 주소(/?m=<메시지>) 는 채팅으로 넘긴다 — 알림 메일·북마크 등 옛 링크가 끊기지 않게
  useEffect(() => {
    const m = params.get("m");
    const c = params.get("c");
    if (m || c) router.replace(`/chat?${m ? `m=${encodeURIComponent(m)}` : `c=${encodeURIComponent(c!)}`}`);
  }, [params, router]);

  useEffect(() => {
    const from = startOfKstDay(new Date());
    void listMyEvents(from, addDays(from, 1)).then((list) => setEvents(list.filter((e) => !e.canceled_at)), fail);
    void listRooms().then(setRooms, fail);
  }, [fail]);

  // 켜 둔 채 시간이 흘러도 진행 중·지난 일정·다음 일정·마감 기준일이 따라오게 1분마다 시각을 다시 잡는다
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!self) return;
    // 하나가 실패해도 나머지는 보이게 실패하면 빈 목록으로 둔다 (오류는 맨 위 띠에)
    void listMyTodos(self.id).then(setTodos, (e) => (fail(e), setTodos([])));
    void listPendingInvites(self.id).then(setInvites, fail);
    // 업무 유형 일정: 내가 참석자이고 불참하지 않은 것, 아직 안 끝난 것 (팀 일정이라 보이기만 하는 남의 것은 뺀다)
    const from = startOfKstDay(new Date());
    void listMyEvents(from, addDays(from, WORK_DAYS)).then(
      (list) =>
        setWork(
          list.filter(
            (e) =>
              !e.canceled_at &&
              e.kind === "work" &&
              new Date(e.ends_at).getTime() > Date.now() &&
              e.attendees.some((a) => a.user_id === self.id && a.response !== "declined"),
          ),
        ),
      (e) => (fail(e), setWork([])),
    );
  }, [self, fail]);

  // 새 메시지가 오면(안 읽은 수가 바뀌면) 최근 대화를 다시 불러온다
  useEffect(() => {
    if (!channels || !dms) return;
    let alive = true;
    void listRecent(channels, dms, RECENT).then((list) => alive && setRecent(list), fail);
    return () => {
      alive = false;
    };
  }, [channels, dms, unread.total, fail]);

  const name = profile?.display_name ?? me.name;
  const nowMs = now.getTime();
  const todayKey = kstDateKey(now);
  const isPast = (e: EventWithAttendees) => !e.all_day && new Date(e.ends_at).getTime() <= nowMs;
  const declined = (e: EventWithAttendees) => e.attendees.some((a) => a.user_id === self?.id && a.response === "declined");
  const past = (events ?? []).filter(isPast);
  const upcoming = (events ?? []).filter((e) => !isPast(e));
  const next = upcoming.find((e) => !e.all_day && !declined(e)); // 불참한 일정은 "다음 일정"으로 치지 않는다
  const nextLive = next && new Date(next.starts_at).getTime() <= nowMs;
  const myRooms = useMemo(() => (events ?? []).filter((e) => e.room_id), [events]);
  const nextRoom = myRooms.find((e) => new Date(e.ends_at).getTime() > nowMs);
  const myMeetings = myRooms
    .filter((e) => !declined(e))
    .map((e): MyMeeting => ({ room_id: e.room_id!, starts_at: e.starts_at, ends_at: e.ends_at }));
  const roomName = (id: string | null) => rooms?.find((r) => r.id === id)?.name ?? "";
  const liveWork = (work ?? []).filter((e) => new Date(e.ends_at).getTime() > nowMs);
  const items: Item[] = [
    ...(todos ?? []).map((t): Item => ({ key: `t:${t.id}`, date: t.due, at: "", todo: t })),
    // 이미 시작해 이어지는 업무(여러 날 프로젝트 등)는 오늘 것으로 친다
    ...liveWork.map((e): Item => {
      const day = kstDateKey(e.starts_at);
      return { key: `w:${e.id}`, date: day < todayKey ? todayKey : day, at: e.starts_at, work: e };
    }),
  ].sort((a, b) => {
    if (a.date !== b.date) return a.date === null ? 1 : b.date === null ? -1 : a.date.localeCompare(b.date);
    if (!!a.work !== !!b.work) return a.work ? -1 : 1; // 같은 날이면 시각이 정해진 업무 일정 먼저
    return a.at.localeCompare(b.at);
  });
  const itemsLoading = todos === null || work === null;
  const urgent = items.filter((i) => i.date !== null && dayDiff(todayKey, i.date) <= 1).length;

  async function done(t: MyTodo) {
    setTodos((list) => list?.filter((x) => x.id !== t.id) ?? null);
    try {
      await finishTodo(t.id);
    } catch (e) {
      fail(e);
      if (self) void listMyTodos(self.id).then(setTodos, fail);
    }
  }

  const openChat = (r: Recent) => {
    setChannel({ id: r.id, name: r.name, type: r.kind === "dm" ? "dm" : undefined });
    router.push(`/chat?c=${encodeURIComponent(r.id)}`);
  };

  // 안 읽은 메시지 카드: 안 읽은 대화 가운데 가장 최근 것을 바로 연다 (없으면 메시지 화면)
  const openUnread = () => {
    const r = recent?.find((x) => getUnread(x.id) > 0);
    if (r) openChat(r);
    else router.push("/chat");
  };

  // 할 일 상자로 스크롤하고 키보드 포커스도 옮긴다. 움직임 줄이기 설정이면 바로 이동
  const goTodos = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("dash-todos")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    document.getElementById("dash-todos-title")?.focus({ preventScroll: true });
  };

  const status = profile?.status ?? "online"; // 오프라인으로 표시·오프라인은 st_ 클래스가 없어 기본 회색
  const shownItems = allTodos ? items : items.slice(0, TODO_SHOWN);

  // 초대에 답한다. 목록에서 먼저 빼고, 실패하면 다시 불러온다. 오늘의 일정의 "응답 전" 칩도 같이 고친다
  async function answer(inv: PendingInvite, response: "accepted" | "declined") {
    const rest = (invites ?? []).filter((x) => x.id !== inv.id);
    const after = rest[(invites ?? []).findIndex((x) => x.id === inv.id)] ?? rest[rest.length - 1];
    setInvites(rest);
    // 누른 줄이 사라지면 포커스가 body 로 가니 다음 초대의 [참석]으로, 없으면 할 일 제목으로 옮긴다
    requestAnimationFrame(() =>
      (after ? document.getElementById(`invite-yes-${after.id}`) : document.getElementById("dash-todos-title"))?.focus(),
    );
    try {
      await respond(inv.id, response);
      const mark = (e: EventWithAttendees) =>
        e.id === inv.id ? { ...e, attendees: e.attendees.map((a) => (a.user_id === self?.id ? { ...a, response } : a)) } : e;
      // 업무 유형 일정이면 할 일 목록에서도: 불참은 빼고 참석은 응답만 바꾼다
      setWork((list) => (list ? (response === "declined" ? list.filter((e) => e.id !== inv.id) : list.map(mark)) : list));
      setEvents(
        (list) =>
          list?.map((e) =>
            e.id === inv.id ? { ...e, attendees: e.attendees.map((a) => (a.user_id === self?.id ? { ...a, response } : a)) } : e,
          ) ?? null,
      );
    } catch (e) {
      fail(e);
      if (self) void listPendingInvites(self.id).then(setInvites, fail);
    }
  }

  return (
    <div className={s.page}>
      <section className={s.hero}>
        <div>
          <h1>
            {greeting(now)}, {name}님!
          </h1>
          <p>{todayLabel(now)} · 오늘의 업무를 확인해 보세요.</p>
        </div>
        <div className={s.heroSide}>
          {profile && (
            <span className={`${s.status} ${s[`st_${status}`] ?? ""}`}>
              <i aria-hidden="true" /> {STATUS_LABEL[status]}
            </span>
          )}
          {next && (
            <Link href={`/calendar?e=${encodeURIComponent(next.id)}`} className={s.heroNext}>
              {nextLive ? "진행 중" : `다음 일정 ${formatKstTime(next.starts_at)}`} · {next.title}
            </Link>
          )}
        </div>
      </section>

      {error && (
        <p className={s.error} role="alert">
          일부를 불러오지 못했습니다: {error}
        </p>
      )}

      <section className={s.cards} aria-label="요약">
        <Link href="/calendar" className={`${s.card} ${s.info}`}>
          <span className={s.cardIcon}>
            <CalendarIcon size={20} />
          </span>
          <span className={s.cardTitle}>오늘의 일정</span>
          <strong className={s.cardValue}>
            {events?.length ?? "–"}
            <small>건</small>
          </strong>
          <span className={s.cardSub}>{next ? `${nextLive ? "진행 중" : "다음 일정"} ${formatKstTime(next.starts_at)}` : "남은 일정 없음"}</span>
        </Link>
        <button type="button" className={`${s.card} ${s.ok}`} onClick={openUnread}>
          <span className={s.cardIcon}>
            <ChatIcon size={20} />
          </span>
          <span className={s.cardTitle}>읽지 않은 메시지</span>
          <strong className={s.cardValue}>
            {unread.total}
            <small>건</small>
          </strong>
          <span className={s.cardSub}>
            채널 {unread.channels} · DM {unread.dms}
          </span>
        </button>
        <Link href="/rooms" className={`${s.card} ${s.warn}`}>
          <span className={s.cardIcon}>
            <RoomIcon size={20} />
          </span>
          <span className={s.cardTitle}>내 회의 예약</span>
          <strong className={s.cardValue}>
            {myRooms.length}
            <small>건</small>
          </strong>
          <span className={s.cardSub}>{nextRoom ? `다음 회의 ${formatKstTime(nextRoom.starts_at)} · ${roomName(nextRoom.room_id)}` : "오늘 예약 없음"}</span>
        </Link>
        <button type="button" className={`${s.card} ${s.bad}`} onClick={goTodos}>
          <span className={s.cardIcon}>
            <CheckIcon size={20} />
          </span>
          <span className={s.cardTitle}>내 할 일</span>
          <strong className={s.cardValue}>
            {itemsLoading ? "–" : items.length}
            <small>건</small>
          </strong>
          <span className={`${s.cardSub} ${urgent ? s.urgent : ""}`}>
            {urgent ? `마감 임박 ${urgent}건` : invites?.length ? `일정 응답 필요 ${invites.length}건` : "마감 임박 없음"}
          </span>
        </button>
      </section>

      <section className={s.box} aria-labelledby="dash-schedule">
        <div className={s.boxHead}>
          <h2 id="dash-schedule">
            <CalendarIcon size={18} /> 오늘의 일정
          </h2>
          <Link href="/calendar" className={s.more}>
            전체 보기 ›
          </Link>
        </div>
        {events === null ? (
          <p className={s.empty}>불러오는 중…</p>
        ) : events.length === 0 ? (
          <div className={s.emptyBox}>
            <p>오늘 잡힌 일정이 없습니다.</p>
            <Link href="/calendar?new=1" className={s.emptyAction}>
              <PlusIcon size={16} /> 일정 추가
            </Link>
          </div>
        ) : (
          <>
            {past.length > 0 && (
              <button type="button" className={s.pastToggle} aria-expanded={showPast} aria-controls="dash-timeline" onClick={() => setShowPast((v) => !v)}>
                <ChevronIcon size={14} open={showPast} /> 지난 일정 {past.length}건
              </button>
            )}
            <ul className={s.timeline} id="dash-timeline">
              {(showPast ? events : upcoming).map((e) => {
                const live = !e.all_day && !isPast(e) && !declined(e) && new Date(e.starts_at).getTime() <= nowMs;
                const mine = e.attendees.find((a) => a.user_id === self?.id);
                const place = roomName(e.room_id) || e.location || KIND_LABEL[e.kind];
                return (
                  <li key={e.id}>
                    <span className={s.tlTime}>
                      {e.all_day ? (
                        <strong>종일</strong>
                      ) : (
                        <>
                          <strong>{formatKstTime(e.starts_at)}</strong>
                          <span>{formatKstTime(e.ends_at)}</span>
                        </>
                      )}
                    </span>
                    <Link
                      href={`/calendar?e=${encodeURIComponent(e.id)}`}
                      className={`${s.tlCard} ${isPast(e) ? s.past : ""} ${live ? s.tlLive : ""}`}
                      style={{ borderLeftColor: colorVar(e.kind) }}
                    >
                      <span className={s.tlText}>
                        <strong>{e.title}</strong>
                        <span>
                          {place}
                          {e.attendees.length > 1 && ` · ${e.attendees.length}명`}
                        </span>
                      </span>
                      {live && <span className={`${s.chip} ${s.chipOk}`}>진행 중</span>}
                      {!live && !isPast(e) && mine?.response === "pending" && <span className={`${s.chip} ${s.chipWarn}`}>응답 전</span>}
                      {mine?.response === "declined" && <span className={`${s.chip} ${s.chipIdle}`}>불참</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {upcoming.length === 0 && <p className={s.empty}>오늘 남은 일정이 없습니다.</p>}
          </>
        )}
      </section>

      <section className={s.quick} aria-label="빠른 실행">
        <button type="button" className={s.quickItem} onClick={() => setDmOpen(true)}>
          <ChatIcon size={20} /> 새 메시지
        </button>
        <Link href="/calendar?new=1" className={s.quickItem}>
          <PlusIcon size={20} /> 일정 추가
        </Link>
        <Link href="/rooms?new=1" className={s.quickItem}>
          <RoomIcon size={20} /> 회의실 예약
        </Link>
      </section>

      <div className={s.grid}>
        <section className={s.box} aria-labelledby="dash-todos-title" id="dash-todos">
          <div className={s.boxHead}>
            <h2 id="dash-todos-title" tabIndex={-1}>
              <CheckIcon size={18} /> 내 할 일
            </h2>
            {!itemsLoading && items.length > 0 && <span className={s.count}>{items.length}건</span>}
          </div>
          {invites && invites.length > 0 && (
            <div className={s.invites}>
              <button
                type="button"
                className={s.invitesHead}
                aria-expanded={invitesOpen}
                aria-controls="dash-invites"
                onClick={() => setInvitesOpen((v) => !v)}
              >
                <ChevronIcon size={14} open={invitesOpen} /> 일정 초대 응답 필요 <strong>{invites.length}건</strong>
              </button>
              {(
                <ul className={s.inviteList} id="dash-invites" hidden={!invitesOpen}>
                  {invites.map((inv) => (
                    <li key={inv.id}>
                      <Link href={`/calendar?e=${encodeURIComponent(inv.id)}`} className={s.inviteText}>
                        <strong>{inv.title}</strong>
                        <span>{longWhen(inv.starts_at, inv.all_day)}</span>
                      </Link>
                      <button
                        type="button"
                        id={`invite-yes-${inv.id}`}
                        className={s.inviteBtn}
                        aria-label={`${inv.title} 참석`}
                        onClick={() => void answer(inv, "accepted")}
                      >
                        참석
                      </button>
                      <button
                        type="button"
                        className={`${s.inviteBtn} ${s.inviteNo}`}
                        aria-label={`${inv.title} 불참`}
                        onClick={() => void answer(inv, "declined")}
                      >
                        불참
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {itemsLoading ? (
            <p className={s.empty}>불러오는 중…</p>
          ) : items.length === 0 ? (
            <div className={s.emptyBox}>
              <p>맡은 할 일이 없습니다.</p>
              <span>채팅에서 “할 일”로 저장하고 담당을 나로 정하거나, 업무 유형 일정을 만들면 여기에 모입니다.</span>
            </div>
          ) : (
            <>
              <ul className={s.todos}>
                {shownItems.map(({ key, todo: t, work: e }) => {
                  if (e) {
                    const due = workDue(e, todayKey, nowMs);
                    return (
                      <li key={key}>
                        <span className={s.workIcon} style={{ color: colorVar(e.kind) }} aria-hidden="true">
                          <CalendarIcon size={16} />
                        </span>
                        <Link href={`/calendar?e=${encodeURIComponent(e.id)}`} className={`${s.todoText} ${s.workLink}`}>
                          <strong>{e.title}</strong>
                          <span>
                            {subtypeLabel(e.kind, e.subtype) || KIND_LABEL[e.kind]} · {longWhen(e.starts_at, e.all_day)}
                          </span>
                        </Link>
                        <span className={`${s.chip} ${due.tone === "ok" ? s.chipOk : due.tone === "warn" ? s.chipWarn : ""}`}>{due.text}</span>
                      </li>
                    );
                  }
                  const due = dueOf(t!.due, todayKey);
                  return (
                    <li key={key}>
                      <input type="checkbox" aria-label={`${t!.task} 끝냄`} onChange={() => void done(t!)} />
                      <span className={s.todoText}>
                        <strong>{t!.task}</strong>
                        <span>
                          {t!.evidence_message_id ? <Link href={`/chat?m=${t!.evidence_message_id}`}>{t!.channel_name}</Link> : t!.channel_name}
                          {!due.tone && ` · ${due.text}`}
                        </span>
                      </span>
                      {due.tone && <span className={`${s.chip} ${due.tone === "bad" ? s.chipBad : s.chipWarn}`}>{due.text}</span>}
                    </li>
                  );
                })}
              </ul>
              {items.length > TODO_SHOWN && (
                <button type="button" className={s.moreBtn} onClick={() => setAllTodos((v) => !v)}>
                  {allTodos ? "접기" : `${items.length - TODO_SHOWN}건 더 보기`}
                </button>
              )}
            </>
          )}
        </section>

        <RoomStatus rooms={rooms} mine={myMeetings} />
      </div>

      <section className={s.box} aria-labelledby="dash-recent">
        <div className={s.boxHead}>
          <h2 id="dash-recent">
            <ChatIcon size={18} /> 최근 대화
          </h2>
          <Link href="/chat" className={s.more}>
            전체 보기 ›
          </Link>
        </div>
        {recent === null ? (
          <p className={s.empty}>불러오는 중…</p>
        ) : recent.length === 0 ? (
          <div className={s.emptyBox}>
            <p>아직 대화가 없습니다.</p>
            <button type="button" className={s.emptyAction} onClick={() => setDmOpen(true)}>
              <ChatIcon size={16} /> 새 메시지
            </button>
          </div>
        ) : (
          <ul className={s.recent}>
            {recent.map((r) => (
              <RecentRow key={r.id} r={r} preview={showMentions(r.body, labels).replace(/\s+/g, " ").trim() || "(첨부)"} onOpen={() => openChat(r)} />
            ))}
          </ul>
        )}
      </section>

      {dmOpen && (
        <NewDmDialog
          onClose={() => setDmOpen(false)}
          onStarted={(id, dmName) => {
            setChannel({ id, name: dmName, type: "dm" });
            setDmOpen(false);
            router.push("/chat");
          }}
        />
      )}
    </div>
  );
}

function RecentRow({ r, preview, onOpen }: { r: Recent; preview: string; onOpen: () => void }) {
  const n = useUnread(r.id);
  return (
    <li>
      <button type="button" className={`${s.recentRow} ${n > 0 ? s.unread : ""}`} onClick={onOpen}>
        <span className={s.recentIcon}>
          {r.kind === "dm" && r.otherId ? <PersonAvatar userId={r.otherId} name={r.name} size={36} /> : <HashIcon size={18} />}
        </span>
        <span className={s.recentText}>
          <strong>{r.name}</strong>
          <span>
            {r.author && <b>{r.author}</b>} {preview}
          </span>
        </span>
        <span className={s.recentSide}>
          <time dateTime={r.at}>{when(r.at)}</time>
          {n > 0 && <span className={s.recentBadge}>{n > 99 ? "99+" : n}</span>}
        </span>
      </button>
    </li>
  );
}
