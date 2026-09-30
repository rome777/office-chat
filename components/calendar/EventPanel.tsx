"use client";

// ② 일정 상세 (오른쪽 패널). 유형·분류·일시·회의실·참석자별 응답, 초대받은 사람은 참석·불참,
// 누구나 자기 시작 전 알림, 만든 사람은 고치기·취소. 같은 부서 팀원의 일정은 TeamEventPanel (DB 가 준 칸만).

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AttendeeResponse, Room } from "@/lib/types/calendar";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { getPeople } from "@/components/people/directory";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { bumpCalendar, useCalendarVersion } from "./calendarBus";
import { CATEGORY_LABEL, KIND_LABEL, REMINDERS, VISIBILITIES, colorVar, reminderLabel, subtypeLabel, teamPreview } from "./kinds";
import { dayLabel } from "./EventLists";
import { cancelEvent, getCategoryNames, getEvent, getMyId, listRooms, respond, setMyReminders, type EventWithAttendees } from "./source";
import { formatKstRange, kstDateKey, toMs } from "./time";
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

  useEffect(() => {
    void getMyId().then(setMyId, () => {});
    void cachedRooms().then(setRooms, () => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setEvent(undefined);
    void getEvent(eventId).then(
      async (e) => {
        if (!alive) return;
        setEvent(e);
        if (!e) return;
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
        {event.room_id && (
          <div className={s.kv}>
            <span>회의실</span>
            <span>
              {room ? `${room.name}${room.capacity ? ` · ${room.capacity}명` : ""}${room.location ? ` · ${room.location}` : ""}` : "회의실"}{" "}
              <Link href="/rooms" className="link">
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
            {event.kind === "meeting" ? "참석자에게만" : VISIBILITIES.find((v) => v.value === event.visibility)?.label}
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

      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      {!canceled && isCreator && (
        <div className={s.foot}>
          <button
            type="button"
            className={s.danger}
            disabled={working}
            onClick={() => {
              const who = event.attendees.length > 1 ? " 참석자에게 취소로 보입니다." : "";
              if (window.confirm(`이 일정을 취소할까요?${who}`)) void run(() => cancelEvent(event.id));
            }}
          >
            일정 취소
          </button>
          <span className={s.grow} />
          <button type="button" className={s.primary} disabled={working} onClick={() => openPanel({ kind: "eventEdit", eventId: event.id })}>
            고치기
          </button>
        </div>
      )}
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
