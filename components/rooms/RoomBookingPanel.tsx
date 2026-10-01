"use client";

// ② 회의실 예약 패널 (오른쪽, PanelState roomBook). 새 예약과 내 예약 고치기(eventId)를 같이 한다.
//   회의실·날짜·시작·종료는 패널 상태에 있다 — 시간표 빈 칸을 누르면 그 값만 바뀌고 제목·참석자 등 나머지 입력은 남는다.
//   입력: 회의 제목 · 회의실 · 날짜 · 시작/종료(30분 단위, 찬 시각은 못 고름) · 공개/비공개 회의 · 반복 · 참석자 · 관련 채널 ·
//         알림 · 참석자 대화방 · 회의 목적 및 메모 · 예약 전 확인(policy.ts — DB 트리거와 같은 규칙)
//   저장하면 유형 "회의" 일정이 된다 (일정 화면·알림·대화방이 그대로 이어진다). 저장 뒤에는 일정 상세 패널을 연다.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Recurrence, Room, RoomBooking } from "@/lib/types/calendar";
import type { Person } from "@/lib/types/people";
import PeoplePicker from "@/components/people/PeoplePicker";
import { getPeople } from "@/components/people/directory";
import { GENERAL_ID } from "@/components/sidebar/channelSource";
import { useMyChannels } from "@/components/sidebar/useChannels";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { cachedRooms } from "@/components/calendar/EventPanel";
import { bumpCalendar, focusCalendarDate, useCalendarVersion } from "@/components/calendar/calendarBus";
import { REMINDERS } from "@/components/calendar/kinds";
import { addDaysKey, weekdayOf } from "@/components/calendar/items";
import {
  DESCRIPTION_MAX,
  RoomConflictError,
  TITLE_MAX,
  createEvent,
  getEvent,
  getMyId,
  listOrgChannelIds,
  openEventChat,
  roomBoard,
  updateEvent,
  updateEventSeries,
  type EventInput,
  type EventWithAttendees,
} from "@/components/calendar/source";
import { addDays, fromKstInput, kstMinuteOfDay, toMs } from "@/components/calendar/time";
import cal from "@/components/calendar/schedule.module.css";
import { RoomGlyph, facilityLabel } from "./facilities";
import { ROOM_POLICY, bookingWindow, checkBooking, durationText, hm, nowSlot, toMin } from "./policy";
import { amIAdmin } from "./source";
import s from "./rooms.module.css";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** 반복 회차 날짜 (DB create_event_series 와 같은 규칙, 최대 52회) — 안내 글자에만 쓴다 */
function repeatDates(rule: Recurrence, first: string, until: string): string[] {
  const out: string[] = [];
  const day = Number(first.slice(8));
  for (let d = first; d <= until && out.length < 52; d = addDaysKey(d, 1)) {
    const w = weekdayOf(d);
    if (rule === "daily" || (rule === "weekdays" && w >= 1 && w <= 5) || (rule === "weekly" && w === weekdayOf(first)) || (rule === "monthly" && Number(d.slice(8)) === day)) out.push(d);
  }
  return out;
}

function whoOf(b: RoomBooking): string {
  if (b.mine) return "내 예약";
  if (b.title) return `"${b.title}"`;
  if (b.is_private || !b.booker_name) return "비공개 예약";
  return `${b.booker_name} 님 예약`;
}

export default function RoomBookingPanel({
  roomId,
  date,
  start,
  end,
  eventId,
}: {
  roomId: string;
  date: string;
  start: string;
  end: string;
  eventId?: string;
}) {
  const { openPanel, closePanel } = useWorkspace();
  const version = useCalendarVersion();
  const { channels } = useMyChannels();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [me, setMe] = useState<Person | null>(null);
  const [admin, setAdmin] = useState(false);
  const [orgChannels, setOrgChannels] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EventWithAttendees | null>(null);
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [channelId, setChannelId] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [repeat, setRepeat] = useState<"" | Recurrence>("");
  const [until, setUntil] = useState("");
  const [remind, setRemind] = useState("10");
  const [memo, setMemo] = useState("");
  const [chat, setChat] = useState(false);
  const [scope, setScope] = useState<"one" | "following">("one");
  const [board, setBoard] = useState<RoomBooking[] | null>(null);
  const [boardError, setBoardError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { today, lastDay } = bookingWindow();
  const s0 = toMin(start);
  const e0 = toMin(end);

  useEffect(() => {
    let alive = true;
    void cachedRooms().then((r) => alive && setRooms(r), () => {});
    void listOrgChannelIds().then((ids) => alive && setOrgChannels(ids), () => {});
    void amIAdmin().then((a) => alive && setAdmin(a));
    void getMyId().then((id) => {
      if (!alive) return;
      setMyId(id);
      void getPeople([id]).then(([p]) => alive && setMe(p ?? null), () => {});
    }, () => {});
    return () => {
      alive = false;
    };
  }, []);

  // 고치기면 그 일정을 읽어 칸을 채운다. 고치다가 새 예약으로 바뀌면(카드 [예약하기]) 칸을 비운다
  const prevEvent = useRef<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setError(null);
    if (!eventId) {
      if (prevEvent.current) {
        setEditing(null);
        setTitle("");
        setPeople([]);
        setChannelId("");
        setPrivate(false);
        setMemo("");
        setScope("one");
      }
      prevEvent.current = undefined;
      return;
    }
    prevEvent.current = eventId;
    void getEvent(eventId).then(async (e) => {
      if (!alive) return;
      if (!e) {
        setError("예약을 찾을 수 없습니다");
        return;
      }
      const id = await getMyId();
      // 참석자를 다 받은 뒤에 칸을 채운다 — 못 받으면 고치지 못하게 한다 (빈 참석자로 저장하면 기존 참석자가 지워진다)
      const others = e.attendees.map((a) => a.user_id).filter((u) => u !== id);
      const list = others.length ? await getPeople(others) : [];
      if (!alive) return;
      setPeople(list);
      setTitle(e.title);
      setChannelId(e.channel_id ?? "");
      setPrivate(e.visibility !== "public");
      setMemo(e.description ?? "");
      setEditing(e);
    }, (err: unknown) => alive && setError(`예약을 불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`));
    return () => {
      alive = false;
    };
  }, [eventId]);

  // 그날 모든 회의실의 예약 (찬 시각·겹침·같은 시간 내 다른 예약을 미리 알려 주려고)
  useEffect(() => {
    let alive = true;
    const from = fromKstInput(date, "00:00");
    setBoardError(false);
    void roomBoard(from, addDays(from, 1)).then(
      (rows) => alive && setBoard(rows),
      () => {
        if (!alive) return;
        setBoard([]);
        setBoardError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [date, version]);

  useEffect(() => {
    setUntil((u) => (u && u >= date && u <= lastDay ? u : addDaysKey(date, 28) > lastDay ? lastDay : addDaysKey(date, 28)));
  }, [date, lastDay]);

  const room = rooms.find((r) => r.id === roomId) ?? null;
  const lockStart = !!editing && toMs(editing.starts_at) <= Date.now();
  const busy = useMemo(
    () => (board ?? []).filter((b) => b.room_id === roomId && !(eventId && b.event_id === eventId)),
    [board, roomId, eventId],
  );
  const overlapping = (rows: RoomBooking[], a: number, z: number) =>
    rows.find((b) => kstMinuteOfDay(b.starts_at) < z && (kstMinuteOfDay(b.ends_at) || 24 * 60) > a) ?? null;
  const channelOptions = useMemo(() => (channels ?? []).filter((c) => c.type !== "dm" && c.id !== GENERAL_ID), [channels]);
  const isMeeting = !editing || editing.kind === "meeting";

  const move = (patch: Partial<{ roomId: string; date: string; start: string; end: string }>) =>
    openPanel({ kind: "roomBook", roomId, date, start, end, ...(eventId ? { eventId } : {}), ...patch });

  const maxLen = admin ? ROOM_POLICY.close - ROOM_POLICY.open : ROOM_POLICY.maxMinutes;
  const startOptions: { m: number; label: string; disabled: boolean }[] = [];
  for (let m = ROOM_POLICY.open; m < ROOM_POLICY.close; m += ROOM_POLICY.slot) {
    const taken = overlapping(busy, m, m + ROOM_POLICY.slot);
    const past = date === today && m < nowSlot();
    startOptions.push({ m, label: `${hm(m)}${taken ? " (예약됨)" : past ? " (지남)" : ""}`, disabled: m !== s0 && (!!taken || past) });
  }
  const endOptions: { m: number; label: string; disabled: boolean }[] = [];
  for (let m = s0 + ROOM_POLICY.slot; m <= Math.min(ROOM_POLICY.close, s0 + maxLen); m += ROOM_POLICY.slot) {
    const blocked = !!overlapping(busy, s0, m);
    const gone = date === today && m <= nowSlot(); // 진행 중인 예약: 지금 칸이 끝나는 시각부터
    endOptions.push({ m, label: `${hm(m)} (${durationText(m - s0)})${blocked ? " · 겹침" : gone ? " (지남)" : ""}`, disabled: m !== e0 && (blocked || gone) });
  }

  const clash = overlapping(busy, s0, e0);
  const double = (board ?? []).find(
    (b) => b.mine && b.room_id !== roomId && !(eventId && b.event_id === eventId) && kstMinuteOfDay(b.starts_at) < e0 && (kstMinuteOfDay(b.ends_at) || 24 * 60) > s0,
  );
  const checks = checkBooking({
    date,
    start: s0,
    end: e0,
    clash: clash ? `${hm(kstMinuteOfDay(clash.starts_at))}~${hm(kstMinuteOfDay(clash.ends_at) || 24 * 60)} ${whoOf(clash)}` : null,
    double: double ? (rooms.find((r) => r.id === double.room_id)?.name ?? "다른 회의실") : null,
    people: people.length + 1,
    capacity: room?.capacity ?? null,
    admin,
    lockStart,
  });
  const titleOk = title.trim().length > 0 && [...title.trim()].length <= TITLE_MAX;
  const valid = titleOk && !!room && !checks.some((c) => c.level === "bad");
  const dates = !editing && repeat ? repeatDates(repeat, date, until || date) : [date];

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const input: EventInput = {
      title: title.trim(),
      description: memo.trim() || null,
      starts_at: fromKstInput(date, start).toISOString(),
      ends_at: fromKstInput(date, end).toISOString(),
      room_id: roomId,
      attendee_ids: people.map((p) => p.id),
      kind: editing?.kind ?? "meeting",
      subtype: editing?.subtype ?? null,
      all_day: false,
      location: editing?.location ?? null,
      // 업무 일정에 잡은 회의실은 그 일정의 공개 범위를 그대로 둔다 (팀원에게 보이는 범위가 바뀌지 않게)
      visibility: isMeeting ? (isPrivate ? "private" : "public") : editing!.visibility,
      channel_id: channelId || null,
      remind_minutes: editing ? undefined : remind ? [Number(remind)] : [],
      repeat: !editing && repeat ? { rule: repeat, until: until || date } : null,
    };
    try {
      const saved = editing
        ? editing.series_id && scope === "following"
          ? await updateEventSeries(editing.id, input)
          : await updateEvent(editing.id, input, editing.attendees.map((a) => a.user_id))
        : await createEvent(input);
      if (!editing && chat && people.length > 0) await openEventChat(saved.id).catch(() => {});
      bumpCalendar();
      focusCalendarDate(date);
      openPanel({ kind: "event", eventId: saved.id });
    } catch (e) {
      setError(
        e instanceof RoomConflictError
          ? editing?.series_id && scope === "following"
            ? "뒤 회차 가운데 다른 예약과 겹치는 날이 있습니다. 이 회차만 고치거나 다른 시간·회의실을 골라 주세요."
            : "그사이 다른 사람이 이 시간을 예약했습니다. 시간표에서 빈 시간을 다시 골라 주세요."
          : e instanceof Error
            ? e.message
            : String(e),
      );
      setSaving(false);
    }
  }

  const span = ROOM_POLICY.close - ROOM_POLICY.open;
  const pct = (m: number) => Math.min(100, Math.max(0, ((m - ROOM_POLICY.open) / span) * 100));

  if (eventId && !editing) return error ? <p className={cal.error}>{error}</p> : <p className={cal.hint}>불러오는 중…</p>;

  return (
    <form
      className={cal.panel}
      aria-label={editing ? "예약 고치기" : "회의실 예약"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className={cal.field}>
        <label className={cal.fieldLabel} htmlFor="rb-title">
          회의 제목 *
        </label>
        <input id="rb-title" type="text" autoFocus={!editing} maxLength={TITLE_MAX} value={title} placeholder="예: 주간 팀 회의" onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className={cal.field}>
        <label className={cal.fieldLabel} htmlFor="rb-room">
          회의실 *
        </label>
        <select id="rb-room" value={roomId} disabled={lockStart} onChange={(e) => move({ roomId: e.target.value })}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.capacity ? ` · ${r.capacity}명` : ""}
              {r.location ? ` · ${r.location}` : ""}
            </option>
          ))}
        </select>
        {room && room.facilities.length > 0 && (
          <div className={s.roomInfo}>
            {room.facilities.map((f) => (
              <span key={f} className={s.fac} title={facilityLabel(f)}>
                <RoomGlyph name={f} />
              </span>
            ))}
            <span>{room.facilities.map(facilityLabel).join(" · ")}</span>
          </div>
        )}
        <div className={cal.bar} aria-hidden="true">
          {busy.map((b) => (
            <span
              key={b.starts_at}
              className={cal.barBusy}
              style={{ left: `${pct(kstMinuteOfDay(b.starts_at))}%`, width: `${Math.max(1, pct(kstMinuteOfDay(b.ends_at) || 24 * 60) - pct(kstMinuteOfDay(b.starts_at)))}%` }}
            />
          ))}
          <span className={`${cal.barMine} ${clash ? cal.conflict : ""}`} style={{ left: `${pct(s0)}%`, width: `${Math.max(1, pct(e0) - pct(s0))}%` }} />
        </div>
        <div className={cal.barScale} aria-hidden="true">
          {[8, 10, 12, 14, 16, 18, 20].map((h) => (
            <span key={h}>{String(h).padStart(2, "0")}</span>
          ))}
        </div>
        {boardError && <p className={cal.hint}>예약 현황을 불러오지 못했습니다 (저장할 때 겹치면 막힙니다).</p>}
      </div>

      <div className={cal.field}>
        <label className={cal.fieldLabel} htmlFor="rb-date">
          예약 날짜 *
        </label>
        <input id="rb-date" type="date" value={date} min={today} max={lastDay} disabled={lockStart} onChange={(e) => e.target.value && move({ date: e.target.value })} />
        <div className={cal.inline}>
          <label className={cal.fieldLabel} htmlFor="rb-start">
            시작 *
          </label>
          <select
            id="rb-start"
            className={cal.inlineSelect}
            value={s0}
            disabled={lockStart}
            onChange={(e) => {
              const m = Number(e.target.value);
              const len = Math.min(e0 - s0 > 0 ? e0 - s0 : 60, maxLen);
              move({ start: hm(m), end: hm(Math.min(ROOM_POLICY.close, m + len)) });
            }}
          >
            {startOptions.map((o) => (
              <option key={o.m} value={o.m} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <label className={cal.fieldLabel} htmlFor="rb-end">
            종료 *
          </label>
          <select id="rb-end" className={cal.inlineSelect} value={e0} onChange={(e) => move({ end: hm(Number(e.target.value)) })}>
            {endOptions.map((o) => (
              <option key={o.m} value={o.m} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {lockStart && <p className={cal.hint}>진행 중인 예약은 날짜·시작·회의실을 바꿀 수 없습니다. 종료 시각만 늘리거나 줄일 수 있습니다.</p>}
      </div>

      {editing?.series_id && (
        <fieldset className={`${cal.field} ${s.fieldset}`}>
          <legend className={cal.fieldLabel}>반복 예약 고치기</legend>
          <div className={cal.radio}>
            <label>
              <input type="radio" name="rb-scope" checked={scope === "one"} onChange={() => setScope("one")} />
              <span>
                이 회차만
                <small>이 날짜의 예약만 바뀝니다.</small>
              </span>
            </label>
            <label>
              <input type="radio" name="rb-scope" checked={scope === "following"} onChange={() => setScope("following")} />
              <span>
                이후 모두
                <small>이 회차와 뒤 회차의 시각·회의실·내용·참석자가 바뀝니다. 날짜는 회차마다 그대로입니다.</small>
              </span>
            </label>
          </div>
        </fieldset>
      )}

      {isMeeting ? (
        <fieldset className={`${cal.field} ${s.fieldset}`}>
          <legend className={cal.fieldLabel}>공개 범위</legend>
          <div className={cal.radio}>
            <label>
              <input type="radio" name="rb-private" checked={!isPrivate} onChange={() => setPrivate(false)} />
              <span>
                공개 회의 (기본)
                <small>시간표에 예약자 이름·부서가 보입니다. 회의 제목·참석자는 참석자에게만 보입니다.</small>
              </span>
            </label>
            <label>
              <input type="radio" name="rb-private" checked={isPrivate} onChange={() => setPrivate(true)} />
              <span>
                비공개 회의
                <small>&quot;비공개 예약&quot;과 시각만 보입니다. 예약자도 참석자에게만 보입니다 (관리자 포함).</small>
              </span>
            </label>
          </div>
          <div className={s.preview}>
            <span>다른 사람에게는</span>
            <span className={`${s.blk} ${isPrivate ? s.priv : ""}`}>
              <strong>{isPrivate ? "비공개 예약" : (me?.display_name ?? "나")}</strong>
              <span>{isPrivate ? `${start}~${end}` : (me?.department ?? "")}</span>
            </span>
          </div>
        </fieldset>
      ) : (
        <p className={cal.note}>업무 일정이라 시간표의 예약자 표시는 그 일정의 공개 범위(팀에 공개일 때만 이름)를 따릅니다.</p>
      )}

      {!editing && (
        <div className={cal.field}>
          <label className={cal.fieldLabel} htmlFor="rb-repeat">
            반복
          </label>
          <div className={cal.inline}>
            <select id="rb-repeat" className={cal.inlineSelect} value={repeat} onChange={(e) => setRepeat(e.target.value as "" | Recurrence)}>
              <option value="">반복 안 함</option>
              <option value="weekly">매주 {DOW[weekdayOf(date)]}요일</option>
              <option value="weekdays">평일 (월~금)</option>
              <option value="daily">매일</option>
              <option value="monthly">매월 {Number(date.slice(8))}일</option>
            </select>
            {repeat && (
              <>
                <span className={cal.hint}>종료</span>
                <input type="date" aria-label="반복 종료일" min={date} max={lastDay} value={until} onChange={(e) => e.target.value && setUntil(e.target.value > lastDay ? lastDay : e.target.value)} />
              </>
            )}
          </div>
          {repeat && (
            <p className={cal.hint}>
              {dates.length}회 예약됩니다. 회의실 반복은 오늘부터 {ROOM_POLICY.windowDays}일까지이고, 겹치는 날이 하나라도 있으면 저장하지 않고 그 날짜를 알려 줍니다.
            </p>
          )}
        </div>
      )}

      <div className={cal.field}>
        <span className={cal.fieldLabel}>참석자 {people.length + 1}명</span>
        <PeoplePicker value={people} onChange={setPeople} exclude={myId ? [myId] : []} fixed={me ? [{ person: me, note: "· 예약자" }] : []} />
        <p className={`${cal.hint} ${room?.capacity && people.length + 1 > room.capacity ? cal.bad : ""}`}>
          나 포함 {people.length + 1}명{room?.capacity ? ` / 수용 ${room.capacity}명` : ""} · 저장하면 초대 알림이 갑니다
        </p>
      </div>

      <div className={cal.field}>
        <label className={cal.fieldLabel} htmlFor="rb-channel">
          관련 채널
        </label>
        <select id="rb-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">없음</option>
          {channelOptions.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
              {orgChannels.has(c.id) ? " (부서 채널)" : ""}
            </option>
          ))}
        </select>
        {channelId && !orgChannels.has(channelId) && <p className={cal.hint}>일반 채널이라, 한 팀 전원이 참석하지 않는 한 프로젝트 일정으로 분류됩니다.</p>}
      </div>

      {!editing && (
        <div className={cal.field}>
          <label className={cal.fieldLabel} htmlFor="rb-remind">
            알림 (나에게)
          </label>
          <select id="rb-remind" value={remind} onChange={(e) => setRemind(e.target.value)}>
            {REMINDERS.map((r) => (
              <option key={r.minutes} value={r.minutes}>
                {r.label}
              </option>
            ))}
            <option value="">알림 없음</option>
          </select>
          <label className={cal.switch}>
            <input type="checkbox" checked={chat && people.length > 0} disabled={people.length === 0} onChange={(e) => setChat(e.target.checked)} />
            예약하면 참석자 대화방 만들기
          </label>
          <p className={cal.hint}>{people.length === 0 ? "참석자를 넣으면 고를 수 있습니다." : people.length === 1 ? "상대와의 DM 을 엽니다." : "참석자로 회의 이름의 비공개 채널을 만들어 이 예약에 이어 둡니다."}</p>
        </div>
      )}

      <div className={cal.field}>
        <label className={cal.fieldLabel} htmlFor="rb-memo">
          회의 목적 및 메모
        </label>
        <textarea id="rb-memo" rows={3} maxLength={DESCRIPTION_MAX} value={memo} placeholder="회의 목적이나 전달 사항 (참석자에게만 보입니다)" onChange={(e) => setMemo(e.target.value)} />
      </div>

      <div className={s.precheck}>
        <h3>예약 전 확인</h3>
        <p className={s.srOnly} aria-live="polite">
          {(() => {
            const n = checks.filter((c) => c.level === "bad").length + (titleOk ? 0 : 1);
            return n ? `확인할 것 ${n}개` : "예약할 수 있습니다";
          })()}
        </p>
        <ul>
          {!titleOk && (
            <li className={s.warnLine}>
              <i>!</i>
              <span>회의 제목을 적어 주세요</span>
            </li>
          )}
          {checks.map((c) => (
            <li key={c.text} className={c.level === "ok" ? s.okLine : c.level === "bad" ? s.badLine : s.warnLine}>
              <i>{c.level === "ok" ? "✓" : c.level === "bad" ? "✕" : "!"}</i>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <p className={cal.error} role="alert">
          {error}
        </p>
      )}

      <div className={cal.foot}>
        <span className={cal.grow}>{!editing && people.length > 0 ? `${people.length}명에게 초대 알림이 갑니다` : editing ? "바꾸면 참석자에게 변경 알림이 갑니다" : "일정에도 회의로 들어갑니다"}</span>
        <button type="button" className={cal.secondary} onClick={() => (editing ? openPanel({ kind: "event", eventId: editing.id }) : closePanel())}>
          취소
        </button>
        <button type="submit" className={cal.primary} disabled={!valid || saving}>
          {saving ? "저장 중…" : editing ? "저장" : dates.length > 1 ? `${dates.length}회 예약` : "예약 완료"}
        </button>
      </div>
    </form>
  );
}
