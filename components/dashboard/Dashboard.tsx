"use client";

// 대시보드 (/, 로그인 뒤 첫 화면, 2026-09-30 WU-35).
// 요약 카드 4개(오늘의 일정·안 읽은 메시지·내 회의실 예약·새 알림) → 오늘의 일정 | 빠른 실행 → 오늘 할 일 | 회의실 사용현황 → 최근 대화.
// 모두 기존 데이터를 읽기만 한다. 누르면 해당 화면으로 주소 이동 (/chat?c=, /chat?m=, /calendar?e=).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Room } from "@/lib/types/calendar";
import { showMentions } from "@/lib/mentions";
import RoomBoard from "@/components/calendar/RoomBoard";
import { KIND_LABEL } from "@/components/calendar/kinds"; // ② 일정 유형 이름 (2026-10-01)
import { listMyEvents, listRooms, type EventWithAttendees } from "@/components/calendar/source";
import { addDays, formatKstTime, kstDateKey, startOfKstDay } from "@/components/calendar/time";
import { useSelf } from "@/components/chat/useSelf";
import { openNotifications, useBellUnread } from "@/components/notifications/bellStore";
import { useMentionLabels } from "@/components/people/directory";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { useMyProfile } from "@/components/profile/profileSource";
import NewDmDialog from "@/components/sidebar/NewDmDialog";
import { useMyChannels, useMyDms, useUnread } from "@/components/sidebar/useChannels";
import { ArrowIcon, BellIcon, CalendarIcon, ChatIcon, HashIcon, PlusIcon, RoomIcon } from "@/components/shell/icons";
import { useUnreadTotals } from "@/components/shell/useUnreadTotals";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { finishTodo, listMyTodos, listRecent, type MyTodo, type Recent } from "./source";
import s from "./dashboard.module.css";

const RECENT = 6;

function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }).format(now));
  if (h < 11) return { text: "좋은 아침입니다", icon: "☀️" };
  if (h < 17) return { text: "좋은 오후입니다", icon: "🌤️" };
  return { text: "좋은 저녁입니다", icon: "🌙" };
}

const todayLabel = (now: Date) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" }).format(now);

function when(iso: string) {
  const d = new Date(iso);
  return kstDateKey(d) === kstDateKey(new Date())
    ? formatKstTime(d)
    : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(d);
}

export default function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, setChannel } = useWorkspace();
  const self = useSelf();
  const { profile } = useMyProfile();
  const { channels } = useMyChannels();
  const { dms } = useMyDms();
  const unread = useUnreadTotals();
  const bell = useBellUnread();
  const labels = useMentionLabels();
  const [now] = useState(() => new Date());
  const [events, setEvents] = useState<EventWithAttendees[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [boardDate, setBoardDate] = useState(() => kstDateKey(new Date()));
  const [todos, setTodos] = useState<MyTodo[] | null>(null);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dmOpen, setDmOpen] = useState(false);
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

  useEffect(() => {
    if (!self) return;
    void listMyTodos(self.id).then(setTodos, fail);
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
  const hello = greeting(now);
  const nowMs = Date.now();
  const upcoming = useMemo(() => (events ?? []).filter((e) => new Date(e.ends_at).getTime() > nowMs), [events, nowMs]);
  const next = upcoming[0];
  const myRooms = useMemo(() => (events ?? []).filter((e) => e.room_id), [events]);
  const nextRoom = myRooms.find((e) => new Date(e.ends_at).getTime() > nowMs);
  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? "";

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

  const todayKey = kstDateKey(new Date());

  return (
    <div className={s.page}>
      <section className={s.hero}>
        <span className={s.heroIcon} aria-hidden="true">
          {hello.icon}
        </span>
        <div>
          <h1>
            {hello.text}, {name}님!
          </h1>
          <p>{todayLabel(now)} · 오늘의 업무를 한눈에 확인해 보세요.</p>
        </div>
      </section>

      {error && (
        <p className={s.error} role="alert">
          일부를 불러오지 못했습니다: {error}
        </p>
      )}

      <section className={s.cards} aria-label="요약">
        <Link href="/calendar" className={`${s.card} ${s.blue}`}>
          <span className={s.cardIcon}>
            <CalendarIcon size={22} />
          </span>
          <span className={s.cardTitle}>오늘의 일정</span>
          <strong className={s.cardValue}>
            {events?.length ?? "–"}
            <small>건</small>
          </strong>
          <span className={s.cardSub}>{next ? `다음 일정 ${formatKstTime(next.starts_at)}` : "남은 일정 없음"}</span>
          <ArrowIcon size={18} />
        </Link>
        <Link href="/chat" className={`${s.card} ${s.violet}`}>
          <span className={s.cardIcon}>
            <ChatIcon size={22} />
          </span>
          <span className={s.cardTitle}>읽지 않은 메시지</span>
          <strong className={s.cardValue}>
            {unread.total}
            <small>건</small>
          </strong>
          <span className={s.cardSub}>
            채널 {unread.channels} · DM {unread.dms}
          </span>
          <ArrowIcon size={18} />
        </Link>
        <Link href="/rooms" className={`${s.card} ${s.green}`}>
          <span className={s.cardIcon}>
            <RoomIcon size={22} />
          </span>
          <span className={s.cardTitle}>내 회의실 예약</span>
          <strong className={s.cardValue}>
            {myRooms.length}
            <small>건</small>
          </strong>
          <span className={s.cardSub}>{nextRoom ? `${formatKstTime(nextRoom.starts_at)} · ${roomName(nextRoom.room_id)}` : "오늘 예약 없음"}</span>
          <ArrowIcon size={18} />
        </Link>
        <button type="button" className={`${s.card} ${s.orange}`} onClick={openNotifications}>
          <span className={s.cardIcon}>
            <BellIcon size={22} />
          </span>
          <span className={s.cardTitle}>새 알림</span>
          <strong className={s.cardValue}>
            {bell}
            <small>건</small>
          </strong>
          <span className={s.cardSub}>확인하지 않은 알림</span>
          <ArrowIcon size={18} />
        </button>
      </section>

      <div className={s.grid}>
        <section className={s.box} aria-labelledby="dash-schedule">
          <div className={s.boxHead}>
            <h2 id="dash-schedule">
              <CalendarIcon size={20} /> 오늘의 일정
            </h2>
            <Link href="/calendar" className={s.more}>
              전체 일정 보기 ›
            </Link>
          </div>
          {events === null ? (
            <p className={s.empty}>불러오는 중…</p>
          ) : events.length === 0 ? (
            <p className={s.empty}>오늘 잡힌 일정이 없습니다.</p>
          ) : (
            <ul className={s.schedule}>
              {events.map((e) => {
                const start = new Date(e.starts_at).getTime();
                const end = new Date(e.ends_at).getTime();
                const state = nowMs >= end ? "종료" : nowMs >= start ? "진행 중" : "예정";
                const mine = e.attendees.find((a) => a.user_id === self?.id);
                return (
                  <li key={e.id}>
                    <Link href={`/calendar?e=${encodeURIComponent(e.id)}`} className={`${s.event} ${state === "종료" ? s.past : ""}`}>
                      <span className={s.eventTime}>
                        {e.all_day ? "종일" : `${formatKstTime(e.starts_at)} – ${formatKstTime(e.ends_at)}`}
                      </span>
                      <span className={s.eventText}>
                        <strong>{e.title}</strong>
                        <span>
                          {roomName(e.room_id) || e.location || KIND_LABEL[e.kind]}
                          {mine?.response === "pending" && " · 응답 전"}
                          {mine?.response === "declined" && " · 불참"}
                        </span>
                      </span>
                      <span className={`${s.chip} ${state === "진행 중" ? s.chipLive : state === "종료" ? s.chipDone : ""}`}>{state}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={s.box} aria-labelledby="dash-quick">
          <div className={s.boxHead}>
            <h2 id="dash-quick">⚡ 빠른 실행</h2>
          </div>
          <div className={s.quick}>
            <button type="button" className={`${s.quickItem} ${s.blue}`} onClick={() => setDmOpen(true)}>
              <span className={s.quickIcon}>
                <ChatIcon size={24} />
              </span>
              <strong>새 메시지</strong>
              <span>동료에게 DM 보내기</span>
            </button>
            <Link href="/calendar?new=1" className={`${s.quickItem} ${s.violet}`}>
              <span className={s.quickIcon}>
                <PlusIcon size={24} />
              </span>
              <strong>일정 추가</strong>
              <span>새 일정을 만드세요</span>
            </Link>
            <Link href="/rooms?new=1" className={`${s.quickItem} ${s.green}`}>
              <span className={s.quickIcon}>
                <RoomIcon size={24} />
              </span>
              <strong>회의실 예약하기</strong>
              <span>빈 회의실을 잡으세요</span>
            </Link>
          </div>
        </section>

        <section className={s.box} aria-labelledby="dash-todos">
          <div className={s.boxHead}>
            <h2 id="dash-todos">✅ 오늘 할 일</h2>
            <span className={s.hint}>채팅의 “할 일”에서 저장한 것 중 내가 담당</span>
          </div>
          {todos === null ? (
            <p className={s.empty}>불러오는 중…</p>
          ) : todos.length === 0 ? (
            <p className={s.empty}>맡은 할 일이 없습니다.</p>
          ) : (
            <ul className={s.todos}>
              {todos.map((t) => {
                const late = t.due !== null && t.due < todayKey;
                const today = t.due === todayKey;
                return (
                  <li key={t.id}>
                    <input type="checkbox" aria-label={`${t.task} 끝냄`} onChange={() => void done(t)} />
                    <span className={s.todoText}>
                      <strong>{t.task}</strong>
                      <span>
                        {t.evidence_message_id ? (
                          <Link href={`/chat?m=${t.evidence_message_id}`}>{t.channel_name}</Link>
                        ) : (
                          t.channel_name
                        )}
                      </span>
                    </span>
                    <span className={`${s.due} ${late ? s.dueLate : today ? s.dueToday : ""}`}>
                      {t.due === null ? "기한 없음" : late ? `${t.due.slice(5)} 지남` : today ? "오늘" : t.due.slice(5)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={s.box} aria-label="회의실 사용현황">
          <RoomBoard rooms={rooms} date={boardDate} onDateChange={setBoardDate} version={0} />
        </section>
      </div>

      <section className={s.box} aria-labelledby="dash-recent">
        <div className={s.boxHead}>
          <h2 id="dash-recent">
            <ChatIcon size={20} /> 최근 대화
          </h2>
          <Link href="/chat" className={s.more}>
            전체 보기 ›
          </Link>
        </div>
        {recent === null ? (
          <p className={s.empty}>불러오는 중…</p>
        ) : recent.length === 0 ? (
          <p className={s.empty}>아직 대화가 없습니다.</p>
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
      <button type="button" className={s.recentRow} onClick={onOpen}>
        <span className={s.recentIcon}>
          {r.kind === "dm" && r.otherId ? <PersonAvatar userId={r.otherId} name={r.name} size={40} /> : <HashIcon size={20} />}
        </span>
        <span className={s.recentText}>
          <strong>{r.kind === "dm" ? r.name : `# ${r.name}`}</strong>
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
