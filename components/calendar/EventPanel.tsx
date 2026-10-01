"use client";

// ② 일정 상세 (오른쪽 패널). 유형·분류·일시·회의실·참석자별 응답, 초대받은 사람은 참석·불참,
// 누구나 자기 시작 전 알림, 만든 사람은 고치기·취소(반복이면 "이 일정만 / 이후 모두").
// [참석자와 대화](DM 또는 일정에 이은 비공개 채널)·[채팅에 공유](고른 대화방에 링크 메시지). 같은 부서 팀원의 일정은 TeamEventPanel (DB 가 준 칸만).
// 회의실 예약(2026-10-01): 진행 중이면 [일찍 끝내기](취소 대신 — 시작한 예약은 DB 가 취소를 막는다), /rooms 에서 고치기는 회의실 예약 패널로.

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMyChannels, useMyDms } from "@/components/sidebar/useChannels";
import { GENERAL_ID } from "@/components/sidebar/channelSource";
import type { AttendeeResponse, Room } from "@/lib/types/calendar";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { getPeople } from "@/components/people/directory";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { ROOM_POLICY } from "@/components/rooms/policy";
import { bumpCalendar, useCalendarVersion } from "./calendarBus";
import { CATEGORY_LABEL, KIND_LABEL, REMINDERS, VISIBILITIES, colorVar, reminderLabel, subtypeLabel, teamPreview } from "./kinds";
import { dayLabel } from "./EventLists";
import {
  cancelEvent,
  cancelEventSeries,
  endRoomBookingEarly,
  getCategoryNames,
  getEvent,
  getMyId,
  getSeriesRange,
  listRooms,
  openEventChat,
  respond,
  setMyReminders,
  shareEventToChannel,
  type EventWithAttendees,
} from "./source";
import type { Recurrence } from "@/lib/types/calendar";
import { weekdayOf } from "./items";
import { formatKstRange, formatKstTime, kstDateKey, toKstInput, toMs } from "./time";
import s from "./schedule.module.css";

const RESPONSE_LABEL: Record<AttendeeResponse, string> = { accepted: "참석", declined: "불참", pending: "응답 전" };

let roomsCache: Promise<Room[]> | null = null;
export const cachedRooms = () => (roomsCache ??= listRooms().catch((e: unknown) => ((roomsCache = null), Promise.reject(e))));

/** 종일이면 "10월 12일 (월) ~ 10월 13일 (화) · 종일", 아니면 "10월 1일 (목) 13:00~14:00" */
export function whenText(startsAt: string, endsAt: string, allDay: boolean): string {
  if (!allDay) return formatKstRange(startsAt, endsAt);
  const first = kstDateKey(startsAt);
  const last = kstDateKey(new Date(Math.max(toMs(startsAt), toMs(endsAt) - 1)));
  return `${dayLabel(first)}${last !== first ? ` ~ ${dayLabel(last)}` : ""} · 종일`;
}

export default function EventPanel({ eventId }: { eventId: string }) {
  const { openPanel } = useWorkspace();
  const version = useCalendarVersion();
  const [event, setEvent] = useState<EventWithAttendees | null | undefined>(undefined);
  const [myId, setMyId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [catName, setCatName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const [series, setSeries] = useState<{ first: string; last: string; count: number } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareTo, setShareTo] = useState("");
  const [shared, setShared] = useState<string | null>(null);
  const { channels } = useMyChannels();
  const { dms } = useMyDms();

  useEffect(() => {
    void getMyId().then(setMyId, () => {});
    void cachedRooms().then(setRooms, () => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setEvent(undefined);
    setSeries(null);
    setConfirmCancel(false);
    setSharing(false);
    setShared(null);
    void getEvent(eventId).then(
      async (e) => {
        if (!alive) return;
        setEvent(e);
        if (!e) return;
        if (e.series_id) void getSeriesRange(e.series_id).then((r) => alive && setSeries(r), () => {});
        const [list, names] = await Promise.all([
          getPeople(e.attendees.map((a) => a.user_id)).catch(() => []),
          getCategoryNames(e.team_unit_id ? [e.team_unit_id] : [], e.channel_id ? [e.channel_id] : []).catch(() => null),
        ]);
        if (!alive) return;
        setPeople(new Map(list.map((p) => [p.id, p.display_name])));
        setCatName(
          e.category === "team"
            ? (e.team_unit_id && names?.units.get(e.team_unit_id)) || ""
            : e.category === "project" && e.channel_id
              ? `#${names?.channels.get(e.channel_id) ?? ""}`
              : "",
        );
      },
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [eventId, version]);

  if (event === undefined) return <p className={s.hint}>불러오는 중…</p>;
  if (event === null) {
    return (
      <div className={s.panel}>
        <h3 className={s.detailTitle}>일정을 찾을 수 없습니다</h3>
        <p className={s.hint}>지워졌거나, 초대받지 않은 일정입니다.</p>
      </div>
    );
  }

  const room = rooms.find((r) => r.id === event.room_id);
  const mine = event.attendees.find((a) => a.user_id === myId);
  const isCreator = event.created_by === myId;
  const canceled = event.canceled_at !== null;
  const nameOf = (id: string) => people.get(id) ?? "알 수 없는 사람";
  const count = (r: AttendeeResponse) => event.attendees.filter((a) => a.response === r).length;
  // 회의실 예약은 시작하면 취소하지 않고, 진행 중이면 일찍 끝낸다 (DB 트리거 events_room_policy)
  const roomStarted = !!event.room_id && toMs(event.starts_at) <= Date.now();
  const roomRunning = roomStarted && Date.now() < toMs(event.ends_at);
  const roomEnded = !!event.room_id && toMs(event.ends_at) <= Date.now();
  function edit() {
    if (event!.room_id && pathname.startsWith("/rooms") && !roomEnded && !event!.all_day) {
      const a = toKstInput(event!.starts_at);
      openPanel({ kind: "roomBook", roomId: event!.room_id, date: a.date, start: a.time, end: toKstInput(event!.ends_at).time, eventId: event!.id });
    } else openPanel({ kind: "eventEdit", eventId: event!.id });
  }

  async function run(action: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await action();
      bumpCalendar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  const reminders = mine?.remind_minutes ?? [];
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const startKey = kstDateKey(event.starts_at);
  const RULE: Record<Recurrence, string> = {
    daily: "매일",
    weekly: `매주 ${DOW[weekdayOf(startKey)]}요일`,
    weekdays: "평일 (월~금)",
    monthly: `매월 ${Number(startKey.slice(8))}일`,
  };
  const shareTargets = [
    ...(channels ?? []).filter((c) => c.type !== "dm" && c.id !== GENERAL_ID).map((c) => ({ id: c.id, label: `#${c.name}` })),
    ...(dms ?? []).map((d) => ({ id: d.id, label: `DM · ${d.other.display_name}` })),
  ];

  async function openChat() {
    setWorking(true);
    setError(null);
    try {
      const ch = await openEventChat(event!.id);
      bumpCalendar();
      router.push(`/chat?c=${encodeURIComponent(ch)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorking(false);
    }
  }

  async function share() {
    if (!shareTo) return;
    const where = room?.name ?? event!.location ?? "";
    const body = `📅 ${event!.title}\n${whenText(event!.starts_at, event!.ends_at, event!.all_day)}${where ? ` · ${where}` : ""}\n${window.location.origin}/calendar?e=${event!.id}`;
    setWorking(true);
    setError(null);
    try {
      await shareEventToChannel(shareTo, body);
      setShared(shareTo);
      setSharing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }
  const categoryWhy =
    event.category === "team"
      ? `${catName || "한 조직"} 사람이 모두 참석자라 팀 일정입니다`
      : event.category === "project"
        ? `${catName || "일반 채널"} 에서 만든 일정입니다`
        : "";

  return (
    <div className={s.panel}>
      <div className={s.chips}>
        <span className={`${s.tag} ${s.solid}`} style={{ ["--c" as string]: colorVar(event.kind) }}>
          {KIND_LABEL[event.kind]}
          {event.subtype ? ` · ${subtypeLabel(event.kind, event.subtype)}` : ""}
        </span>
        {event.category !== "mine" && (
          <span className={s.tag} style={{ ["--c" as string]: event.category === "project" ? "var(--k-work)" : "var(--accent)" }}>
            {CATEGORY_LABEL[event.category]}
            {catName ? ` · ${catName}` : ""}
          </span>
        )}
        {canceled && (
          <span className={s.tag} style={{ ["--c" as string]: "var(--bad)" }}>
            취소됨
          </span>
        )}
      </div>
      <h3 className={`${s.detailTitle} ${canceled ? s.struck : ""}`}>{event.title}</h3>

      <div className={s.rows}>
        <div className={s.kv}>
          <span>일시</span>
          <span>{whenText(event.starts_at, event.ends_at, event.all_day)}</span>
        </div>
        {event.recurrence && (
          <div className={s.kv}>
            <span>반복</span>
            <span>
              {RULE[event.recurrence]}
              {series && ` · ${dayLabel(kstDateKey(series.first))} ~ ${dayLabel(kstDateKey(series.last))} (${series.count}회)`}
            </span>
          </div>
        )}
        {event.room_id && (
          <div className={s.kv}>
            <span>회의실</span>
            <span>
              {room ? `${room.name}${room.capacity ? ` · ${room.capacity}명` : ""}${room.location ? ` · ${room.location}` : ""}` : "회의실"}{" "}
              <Link href={`/rooms?date=${startKey}`} className="link">
                예약 현황
              </Link>
            </span>
          </div>
        )}
        {event.location && (
          <div className={s.kv}>
            <span>장소</span>
            <span>{event.location}</span>
          </div>
        )}
        <div className={s.kv}>
          <span>공개</span>
          <span>
            {event.kind === "meeting"
              ? event.room_id
                ? event.visibility === "public"
                  ? "공개 회의 — 내용은 참석자에게만, 회의실 시간표에는 예약자 이름·부서"
                  : "비공개 회의 — 회의실 시간표에는 '비공개 예약'만"
                : "참석자에게만"
              : VISIBILITIES.find((v) => v.value === event.visibility)?.label}
            {event.kind !== "meeting" && (
              <span className={s.hint}> · 팀원에게는 {teamPreview(event.kind, event.visibility, event.subtype)}</span>
            )}
          </span>
        </div>
        {categoryWhy && (
          <div className={s.kv}>
            <span>분류</span>
            <span>{categoryWhy}</span>
          </div>
        )}
      </div>

      {event.attendees.length > 1 && (
        <div className={s.field}>
          <span className={s.fieldLabel}>
            {event.kind === "work" ? "담당자" : "참석자"} {event.attendees.length}명 · 참석 {count("accepted")} · 불참 {count("declined")} · 응답 전 {count("pending")}
          </span>
          <ul className={s.people}>
            {event.attendees.map((a) => (
              <li key={a.user_id}>
                <PersonAvatar userId={a.user_id} name={nameOf(a.user_id)} size={24} />
                <span>
                  {nameOf(a.user_id)}
                  {a.user_id === event.created_by && <span className={s.hint}> · 만든 사람</span>}
                  {a.user_id === myId && <span className={s.hint}> · 나</span>}
                </span>
                <span className={`${s.resp} ${s[`resp_${a.response}`]}`}>{RESPONSE_LABEL[a.response]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!canceled && mine && !isCreator && (
        <div className={s.field}>
          <span className={s.fieldLabel}>내 응답</span>
          <div className={s.respond} role="group" aria-label="내 응답">
            {(["accepted", "declined"] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={mine.response === r}
                disabled={working || mine.response === r}
                onClick={() => void run(() => respond(event.id, r))}
              >
                {RESPONSE_LABEL[r]}
              </button>
            ))}
          </div>
          {mine.response === "declined" && <p className={s.hint}>불참하면 만든 사람에게 알림이 가고, 시작 전 알림은 오지 않습니다.</p>}
        </div>
      )}

      {mine && !canceled && (
        <div className={s.field}>
          <span className={s.fieldLabel}>알림 (나에게)</span>
          <div className={s.chips}>
            {reminders.length === 0 && <span className={s.hint}>없음</span>}
            {reminders.map((m) => (
              <span key={m} className={s.pill}>
                {reminderLabel(m)}
                <button
                  type="button"
                  aria-label={`${reminderLabel(m)} 알림 빼기`}
                  disabled={working}
                  onClick={() => void run(() => setMyReminders(event.id, reminders.filter((x) => x !== m)))}
                >
                  ×
                </button>
              </span>
            ))}
            {reminders.length < REMINDERS.length && (
              <select
                className={s.inlineSelect}
                aria-label="알림 추가"
                value=""
                disabled={working}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  if (e.target.value) void run(() => setMyReminders(event.id, [...reminders, m]));
                }}
              >
                <option value="">+ 알림 추가</option>
                {REMINDERS.filter((r) => !reminders.includes(r.minutes)).map((r) => (
                  <option key={r.minutes} value={r.minutes}>
                    {r.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className={s.hint}>알림함·토스트·브라우저 알림으로 옵니다. 다른 참석자의 알림은 바뀌지 않습니다.</p>
        </div>
      )}

      {event.description && (
        <div className={s.field}>
          <span className={s.fieldLabel}>상세 내용</span>
          <p className={s.description}>{event.description}</p>
        </div>
      )}

      {!canceled && mine && event.attendees.length > 1 && (
        <div className={s.field}>
          <div className={s.chips}>
            <button type="button" className={s.secondary} disabled={working} onClick={() => void openChat()}>
              참석자와 대화
            </button>
            <button type="button" className={s.secondary} disabled={working} aria-expanded={sharing} onClick={() => setSharing((v) => !v)}>
              채팅에 공유
            </button>
          </div>
          <p className={s.hint}>
            {event.attendees.length === 2 ? "상대와의 DM 을 엽니다." : event.chat_channel_id ? "이 일정의 대화방을 엽니다." : "참석자로 비공개 채널을 만들어 이 일정에 이어 둡니다."}
          </p>
        </div>
      )}
      {!canceled && mine && event.attendees.length <= 1 && (
        <div className={s.chips}>
          <button type="button" className={s.secondary} disabled={working} aria-expanded={sharing} onClick={() => setSharing((v) => !v)}>
            채팅에 공유
          </button>
        </div>
      )}
      {sharing && (
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor="ev-share">
            공유할 대화방
          </label>
          <div className={s.inline}>
            <select id="ev-share" className={s.inlineSelect} value={shareTo} onChange={(e) => setShareTo(e.target.value)}>
              <option value="">고르세요</option>
              {shareTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button type="button" className={s.primary} disabled={!shareTo || working} onClick={() => void share()}>
              보내기
            </button>
          </div>
          <p className={s.hint}>제목·일시와 이 일정 링크를 보냅니다. 참석자가 아닌 사람이 누르면 "찾을 수 없음"으로 보입니다.</p>
        </div>
      )}
      {shared && (
        <p className={s.note} role="status">
          보냈습니다. <Link href={`/chat?c=${encodeURIComponent(shared)}`} className="link">대화방에서 보기</Link>
        </p>
      )}

      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      {confirmCancel && !canceled && isCreator && (
        <div className={s.note} role="alertdialog" aria-label="일정 취소 확인">
          <p style={{ margin: "0 0 8px" }}>
            {event.series_id ? "반복 일정입니다. 어디까지 취소할까요?" : "이 일정을 취소할까요?"}
            {event.attendees.length > 1 ? " 참석자에게 취소 알림이 갑니다." : ""}
          </p>
          <div className={s.chips}>
            <button type="button" className={s.danger} disabled={working} onClick={() => void run(() => cancelEvent(event.id))}>
              {event.series_id ? "이 일정만 취소" : "취소하기"}
            </button>
            {event.series_id && (
              <button type="button" className={s.danger} disabled={working} onClick={() => void run(async () => void (await cancelEventSeries(event.id)))}>
                이후 모두 취소
              </button>
            )}
            <button type="button" className={s.secondary} disabled={working} onClick={() => setConfirmCancel(false)}>
              그만두기
            </button>
          </div>
        </div>
      )}

      {!canceled && isCreator && roomRunning && (
        <p className={s.hint}>진행 중인 회의실 예약은 취소 대신 [일찍 끝내기]로 남은 시간을 돌려줍니다 (종료를 다음 {ROOM_POLICY.slot}분 칸으로).</p>
      )}
      {!canceled && isCreator && (
        <div className={s.foot}>
          {roomRunning ? (
            <button
              type="button"
              className={s.danger}
              disabled={working}
              onClick={() => void run(async () => void (await endRoomBookingEarly(event.id, ROOM_POLICY.slot)))}
            >
              일찍 끝내기
            </button>
          ) : (
            !roomStarted && (
              <button type="button" className={s.danger} disabled={working} onClick={() => setConfirmCancel(true)}>
                {event.room_id ? "예약 취소" : "일정 취소"}
              </button>
            )
          )}
          <span className={s.grow} />
          <button type="button" className={s.primary} disabled={working} onClick={edit}>
            고치기
          </button>
        </div>
      )}
      {!canceled && event.room_id && roomEnded && <p className={s.hint}>끝난 회의실 예약은 시각·회의실을 바꾸거나 취소할 수 없습니다 (기록으로 남깁니다).</p>}
      {!canceled && event.room_id && roomRunning && !isCreator && <p className={s.hint}>{formatKstTime(event.ends_at)}까지 사용 중입니다.</p>}
      {canceled && <p className={s.hint}>취소된 일정은 지우지 않고 남깁니다.</p>}
    </div>
  );
}

/** 같은 부서 팀원의 일정. DB(list_team_events)가 공개 범위에 맞게 준 칸만 보인다 */
export function TeamEventPanel({
  name,
  userId,
  eventKind,
  label,
  title,
  location,
  assignees,
  startsAt,
  endsAt,
  allDay,
}: {
  name: string;
  userId: string;
  eventKind: "work" | "personal" | "outside" | "leave" | null;
  label: string;
  title: string | null;
  location: string | null;
  assignees: string[];
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}) {
  const busy = eventKind === null;
  return (
    <div className={s.panel}>
      <div className={s.chips}>
        <span className={`${s.tag} ${s.solid}`} style={{ ["--c" as string]: colorVar(eventKind ?? "busy") }}>
          {eventKind ? KIND_LABEL[eventKind] : "바쁨"}
        </span>
        <span className={s.tag} style={{ ["--c" as string]: "var(--accent)" }}>
          팀 일정
        </span>
      </div>
      <h3 className={s.detailTitle} style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PersonAvatar userId={userId} name={name} size={28} />
        {name} · {title ?? label}
      </h3>
      <div className={s.rows}>
        <div className={s.kv}>
          <span>{eventKind === "work" && title ? "기간" : "시간"}</span>
          <span>{whenText(startsAt, endsAt, allDay)}</span>
        </div>
        {location && (
          <div className={s.kv}>
            <span>장소</span>
            <span>{location}</span>
          </div>
        )}
        {assignees.length > 0 && (
          <div className={s.kv}>
            <span>담당자</span>
            <span>{assignees.join(", ")}</span>
          </div>
        )}
      </div>
      <p className={s.note}>
        {name} 님이 고른 공개 범위만큼만 보입니다. 그 밖의 내용은 만든 사람과 참석자만 봅니다.
      </p>
    </div>
  );
}
