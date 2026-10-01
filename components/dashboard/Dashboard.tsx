"use client";

// 대시보드 (/, 로그인 뒤 첫 화면, 2026-09-30 WU-35 · 2026-10-01 개편 WU-45).
// 정보 우선순위대로 위에서 아래로: 인사말(내 상태·다음 일정) → 요약 카드 4개(오늘의 일정·안 읽은 메시지·내 회의 예약·내 할 일)
// → 오늘의 일정 | 내 할 일 → 빠른 실행(일정 추가·새 메시지·회의실 예약) → 회사 공지 | 최근 대화 | 회의실 현황 (2026-10-01 WU-50 사용자 배치, 지난 일정은 접음).
// 내 할 일 (WU-47): 맨 위 "일정 초대 응답 필요 N건" 묶음([참석]·[불참]) + 할 일(todos)과 7일 안 업무 유형 일정을 기한순으로 섞은 한 목록.
// 회사 공지 (WU-50): 공지 채널(notice_unit_id)의 고정 공지(최대 2) + 최근 공지, 안 읽은 공지는 진하게 + N. 누르면 /chat?m=.
//   공지 채널이 없으면 상자를 그리지 않고 아래 줄은 최근 대화 | 회의실 현황 두 칸. 공지·최근 대화의 긴 글은 한 줄에서 말줄임(…).
// 오늘 팀 부재 (WU-49): 오늘의 일정 상자 맨 위 한 줄 — 같은 부서 팀원의 휴가·부재·외근(list_team_events, 공개 범위대로 가려 옴). 없으면 줄을 숨긴다.
// 새 표는 없다. 쓰는 것은 할 일 끝냄(done_at)과 일정 초대 응답(respond)뿐. 누르면 해당 화면으로 주소 이동 (/chat?c=, /chat?m=, /calendar?e=).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Room } from "@/lib/types/calendar";
import { showMentions } from "@/lib/mentions";
import { colorVar, KIND_LABEL, subtypeLabel } from "@/components/calendar/kinds"; // ② 일정 유형 이름·색 (2026-10-01)
import { listMyEvents, listRooms, respond, type EventWithAttendees } from "@/components/calendar/source";
import { addDays, formatKstTime, fromKstInput, kstDateKey, kstParts, startOfKstDay } from "@/components/calendar/time";
import { useSelf } from "@/components/chat/useSelf";
import { useMentionLabels } from "@/components/people/directory";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { STATUS_LABEL, useMyProfile } from "@/components/profile/profileSource";
import NewDmDialog from "@/components/sidebar/NewDmDialog";
import { getUnread } from "@/components/sidebar/unread";
import { useMyChannels, useMyDms, useUnread } from "@/components/sidebar/useChannels";
import { CalendarIcon, ChatIcon, CheckIcon, ChevronIcon, HashIcon, MegaphoneIcon, PlusIcon, RoomIcon } from "@/components/shell/icons";
import { useUnreadTotals } from "@/components/shell/useUnreadTotals";
import { openProfileCard } from "@/components/shell/cardStore";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import RoomStatus, { type MyMeeting } from "./RoomStatus";
import {
  finishTodo,
  listMyTodos,
  listNotices,
  listPendingInvites,
  listRecent,
  listTeamAway,
  type MyTodo,
  type NoticeBoard,
  type PendingInvite,
  type Recent,
  type TeamAway,
} from "./source";
import s from "./dashboard.module.css";

const RECENT = 6;
const NOTICES = 5; // 회사 공지 상자에 보일 공지 수 (고정 포함)
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

/** "2026-10-03" → "10월 3일" */
const md = (key: string) => `${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일`;

/** 끝 시각이 속한 날 (종일·자정에 끝나면 그 전날) */
const endKey = (endsAt: string) => kstDateKey(new Date(new Date(endsAt).getTime() - 1));

/** 할 일 기한 표시. tone 이 있으면 칩, 없으면 글자만 */
function dueOf(due: string | null, todayKey: string): { text: string; tone: "bad" | "warn" | null } {
  if (due === null) return { text: "기한 없음", tone: null };
  const d = dayDiff(todayKey, due);
  if (d < 0) return { text: `${-d}일 지남`, tone: "bad" };
  if (d === 0) return { text: "오늘 마감", tone: "warn" };
  if (d === 1) return { text: "내일 마감", tone: "warn" }; // 카드의 "마감 임박"(내일까지)과 같은 기준
  return { text: `${md(due)} 마감`, tone: null };
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

/** 업무 일정이 이미 시작했나 (종일은 그날 0시에 시작한 것으로 본다) */
const started = (e: EventWithAttendees, nowMs: number) => new Date(e.starts_at).getTime() <= nowMs;

/** 업무 일정의 마감 날짜 — 끝 시각이 속한 날 (종일·자정에 끝나면 그 전날) */
const endDay = (e: EventWithAttendees) => endKey(e.ends_at);

/** 정렬·마감 임박 기준 날짜: 아직 시작 전이면 시작하는 날, 이미 시작했으면 끝나는 날 */
const workDate = (e: EventWithAttendees, nowMs: number) => (started(e, nowMs) ? endDay(e) : kstDateKey(e.starts_at));

/** 업무 일정의 기한 칩 — 시작 전: 오늘·내일·D-n. 시작 후: 오늘 끝나면 "진행 중", 내일 끝나면 "내일 마감", 그 뒤면 "진행 중 · ~10월 5일" */
function workDue(e: EventWithAttendees, todayKey: string, nowMs: number): { text: string; tone: "ok" | "warn" | null } {
  if (started(e, nowMs)) {
    const end = endDay(e);
    const left = dayDiff(todayKey, end);
    if (left <= 0) return e.all_day ? { text: "오늘 마감", tone: "warn" } : { text: "진행 중", tone: "ok" };
    if (left === 1) return { text: "내일 마감", tone: "warn" };
    return { text: `진행 중 · ~${md(end)}`, tone: "ok" };
  }
  const d = dayDiff(todayKey, kstDateKey(e.starts_at));
  if (d <= 0) return { text: e.all_day ? "오늘" : `오늘 ${formatKstTime(e.starts_at)}`, tone: "warn" };
  if (d === 1) return { text: "내일", tone: "warn" };
  return { text: `D-${d}`, tone: null };
}

/** 팀 부재 칩 글자. 종일: "연차", "연차 ~10월 3일". 시간: "오후 반차", "외근 15:00~18:00",
 *  날을 걸치면 오늘 밖의 끝은 날짜로·어제 시작이면 시작을 빼고 ("외근 15:00~10월 2일", "외근 ~02:00") */
function awayText(a: TeamAway, todayKey: string): string {
  const last = endKey(a.endsAt);
  if (a.allDay) return last > todayKey ? `${a.label} ~${md(last)}` : a.label;
  const startsToday = kstDateKey(a.startsAt) === todayKey;
  if (a.kind === "leave" && a.label === "반차" && startsToday && last === todayKey) {
    return kstParts(a.startsAt).hour < 12 ? "오전 반차" : "오후 반차";
  }
  const from = startsToday ? formatKstTime(a.startsAt) : "";
  const to = last > todayKey ? md(last) : formatKstTime(a.endsAt);
  return `${a.label} ${from}~${to}`;
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
  const [away, setAway] = useState<TeamAway[]>([]);
  // undefined = 불러오는 중, null = 공지 채널 없음(상자를 그리지 않음)
  const [notices, setNotices] = useState<NoticeBoard | null | undefined>(undefined);
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

  // 회사 공지: 공지 채널의 안 읽은 수가 바뀌면(남이 올린 새 공지·읽음) 다시 부르고, 다른 탭에 갔다 돌아오면 다시 부른다
  //   (내가 올린 공지·고치기·지우기·고정·답글은 안 읽은 수를 바꾸지 않아서). 실패하면 받아 둔 것을 두고 오류 띠에
  const noticeUnread = useUnread(notices?.channelId ?? "");
  const [noticeTick, setNoticeTick] = useState(0);
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setNoticeTick((n) => n + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  useEffect(() => {
    if (!self) return;
    let alive = true;
    void listNotices(self.id, NOTICES).then(
      (b) => alive && setNotices(b),
      (e) => {
        if (!alive) return;
        fail(e);
        setNotices((b) => (b === undefined ? null : b));
      },
    );
    return () => {
      alive = false;
    };
  }, [self, noticeUnread, noticeTick, fail]);

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

  // 오늘 팀 부재 — 켜 둔 채 날이 바뀌면 새 날 것으로. 실패하면 오류 띠 없이 줄만 숨긴다 (부가 정보라 다른 상자의 오류 문구를 덮지 않게)
  useEffect(() => {
    let alive = true;
    const from = startOfKstDay(fromKstInput(todayKey, "12:00"));
    void listTeamAway(from, addDays(from, 1)).then(
      (list) => alive && setAway(list),
      () => alive && setAway([]),
    );
    return () => {
      alive = false;
    };
  }, [todayKey]);
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
  // 이미 돌아온 사람(오늘 끝난 반차·외근)은 뺀다. 종일 먼저, 그다음 시작 순
  const awayNow = away
    .filter((a) => new Date(a.endsAt).getTime() > nowMs)
    .sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.startsAt.localeCompare(b.startsAt)));
  const items: Item[] = [
    ...(todos ?? []).map((t): Item => ({ key: `t:${t.id}`, date: t.due, at: "", todo: t })),
    // 이미 시작해 이어지는 업무(여러 날 프로젝트 등)는 끝나는 날로 친다 — 마감이 멀면 "마감 임박"에서 빠진다
    ...liveWork.map((e): Item => ({ key: `w:${e.id}`, date: workDate(e, nowMs), at: e.starts_at, work: e })),
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

      {/* 오늘의 일정 | 내 할 일 (2026-10-01 WU-50 사용자 배치) */}
      <div className={s.grid}>
        <section className={s.box} aria-labelledby="dash-schedule">
          <div className={s.boxHead}>
            <h2 id="dash-schedule">
              <CalendarIcon size={18} /> 오늘의 일정
            </h2>
            <Link href="/calendar" className={s.more}>
              전체 보기 ›
            </Link>
          </div>
          {awayNow.length > 0 && (
            <div className={s.away}>
              <span className={s.awayHead} id="dash-away">
                팀 부재 <strong>{new Set(awayNow.map((a) => a.userId)).size}명</strong>
              </span>
              <ul className={s.awayList} aria-labelledby="dash-away">
                {awayNow.map((a) => {
                  const text = awayText(a, todayKey);
                  const detail = [a.title, a.location].filter(Boolean).join(" · ");
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        className={s.awayChip}
                        title={detail || undefined}
                        aria-label={`${a.name} ${text}${detail ? ` · ${detail}` : ""} — 프로필 보기`}
                        onClick={() => openProfileCard(a.userId)}
                      >
                        <PersonAvatar userId={a.userId} name={a.name} size={22} />
                        <strong>{a.name}</strong>
                        <i style={{ background: colorVar(a.kind) }} aria-hidden="true" />
                        <span>{text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
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
      </div>

      <section className={s.quick} aria-label="빠른 실행">
        <Link href="/calendar?new=1" className={s.quickItem}>
          <PlusIcon size={20} /> 일정 추가
        </Link>
        <button type="button" className={s.quickItem} onClick={() => setDmOpen(true)}>
          <ChatIcon size={20} /> 새 메시지
        </button>
        <Link href="/rooms?new=1" className={s.quickItem}>
          <RoomIcon size={20} /> 회의실 예약
        </Link>
      </section>

      {/* 회사 공지 | 최근 대화 | 회의실 현황 — 공지 채널이 없으면 두 칸 */}
      <div className={notices === null ? s.grid : s.trio}>
        {notices !== null && (
          <section className={s.box} aria-labelledby="dash-notice">
            <div className={s.boxHead}>
              <h2 id="dash-notice">
                <MegaphoneIcon size={18} /> 회사 공지
              </h2>
              {notices && (
                <Link href={`/chat?c=${encodeURIComponent(notices.channelId)}`} className={s.more}>
                  전체 보기 ›
                </Link>
              )}
            </div>
            {notices === undefined ? (
              <p className={s.empty}>불러오는 중…</p>
            ) : notices.notices.length === 0 ? (
              <div className={s.emptyBox}>
                <p>아직 올라온 공지가 없습니다.</p>
                <span>#{notices.channelName} 에 공지가 올라오면 여기에 모입니다.</span>
              </div>
            ) : (
              <ul className={s.notices}>
                {notices.notices.map((n) => (
                  <li key={n.id}>
                    <Link href={`/chat?m=${n.id}`} className={`${s.noticeRow} ${n.unread ? s.unread : ""}`}>
                      <span className={s.noticeText}>
                        <strong>
                          {n.pinned && <span className={s.pinTag}>고정</span>}{n.pinned && " "}
                          {showMentions(n.title, labels)}
                        </strong>
                        <span>
                          {n.author ?? "알 수 없는 사람"} · <time dateTime={n.at}>{when(n.at)}</time>
                          {n.replies > 0 && ` · 답글 ${n.replies}`}
                        </span>
                      </span>
                      {n.unread && (
                        <>
                          <span className={s.newTag} aria-hidden="true">
                            N
                          </span>
                          <span className={s.srOnly}>안 읽음</span>
                        </>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

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

        <RoomStatus rooms={rooms} mine={myMeetings} />
      </div>

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
