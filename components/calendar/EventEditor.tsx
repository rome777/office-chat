"use client";

// ② 일정 만들기·고치기 (오른쪽 패널). 유형(회의·업무·개인·외근·휴가/부재)을 고르면 필요한 칸만 보인다.
//   세부 유형은 휴가·부재만 버튼으로 고른다 (팀원에게 보일 말을 정한다 — 병가는 "휴가", 휴직은 "부재").
//   나머지 유형은 제목 칸에 예시로만 보이고, 저장할 때 제목에서 알아낸다 (2026-10-01 사용자 결정)
//   회의: 회의실·참석자 기본 / 업무: 담당자 기본, [+ 회의실] / 개인: 참석자 없음 / 외근: 장소 기본, [+ 동행] / 휴가·부재: 종일 기본
//   시작·종료는 각각 날짜와 시간 (여러 날에 걸쳐도 된다). 종일이면 시간 칸이 사라진다.
//   공개 범위(회의 제외): 팀에 공개 · 시간만 공개 · 나만 보기 — 같은 부서 팀원에게 무엇이 보이는지 바로 아래에 보여 준다
//   관련 채널(회의·업무): 일반 채널이면 프로젝트 일정으로 분류된다 (분류는 저장할 때 DB 가 정한다)
// 반복은 다음 단계(4단계)에서 넣는다.

import { useEffect, useMemo, useState } from "react";
import type { EventKind, Room, Visibility } from "@/lib/types/calendar";
import type { Person } from "@/lib/types/people";
import PeoplePicker from "@/components/people/PeoplePicker";
import { getPeople } from "@/components/people/directory";
import { GENERAL_ID } from "@/components/sidebar/channelSource";
import { useMyChannels } from "@/components/sidebar/useChannels";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { bumpCalendar, focusCalendarDate } from "./calendarBus";
import { cachedRooms } from "./EventPanel";
import {
  KINDS,
  REMINDERS,
  VISIBILITIES,
  colorVar,
  defaultReminders,
  defaultVisibility,
  detectSubtype,
  reminderLabel,
  subtypeLabel,
  teamPreview,
  titleExamples,
  titleFallback,
} from "./kinds";
import { addDaysKey } from "./items";
import {
  DESCRIPTION_MAX,
  LOCATION_MAX,
  RoomConflictError,
  TITLE_MAX,
  createEvent,
  getEvent,
  getMyId,
  listOrgChannelIds,
  roomBusy,
  updateEvent,
  type BusySlot,
  type EventInput,
  type EventWithAttendees,
} from "./source";
import TimeSelect, { toMinutes } from "./TimeSelect";
import { HOUR_END, HOUR_START } from "./TimeGrid";
import { addDays, formatKstTime, fromKstInput, kstDateKey, kstMinuteOfDay, toKstInput, toMs } from "./time";
import s from "./schedule.module.css";

export type EditorProps = { mode: "new"; date: string; time?: string; withIds?: string[] } | { mode: "edit"; eventId: string };

type Form = {
  kind: EventKind;
  /** 휴가·부재의 종류 (버튼으로 고른다) */
  leave: string;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  roomId: string;
  showRoom: boolean;
  location: string;
  showPlace: boolean;
  showPeople: boolean;
  channelId: string;
  showChannel: boolean;
  visibility: Visibility;
  reminders: number[];
  description: string;
};

const hasPeopleByDefault = (kind: EventKind) => kind === "meeting" || kind === "work";

/** 시작을 옮기면 종료도 같은 간격만큼 따라간다 (간격이 없거나 거꾸로면 1시간) */
function shiftEnd(f: Form, startDate: string, startTime: string): Pick<Form, "endDate" | "endTime"> {
  const oldStart = fromKstInput(f.startDate, f.startTime).getTime();
  const oldEnd = fromKstInput(f.endDate, f.endTime).getTime();
  const gap = oldEnd > oldStart ? oldEnd - oldStart : 60 * 60000;
  const end = toKstInput(new Date(fromKstInput(startDate, startTime).getTime() + gap));
  return { endDate: end.date, endTime: end.time };
}

function newForm(date: string, time?: string): Form {
  const start = time ?? "10:00";
  return {
    kind: "meeting",
    leave: "annual",
    title: "",
    allDay: false,
    startDate: date,
    startTime: start,
    ...(() => {
      const end = toKstInput(new Date(fromKstInput(date, start).getTime() + 60 * 60000));
      return { endDate: end.date, endTime: end.time };
    })(),
    roomId: "",
    showRoom: true,
    location: "",
    showPlace: false,
    showPeople: true,
    channelId: "",
    showChannel: false,
    visibility: defaultVisibility("meeting"),
    reminders: defaultReminders("meeting", false),
    description: "",
  };
}

function editForm(e: EventWithAttendees, myId: string): Form {
  const start = toKstInput(e.starts_at);
  const end = toKstInput(e.ends_at);
  const lastDay = kstDateKey(new Date(Math.max(toMs(e.starts_at), toMs(e.ends_at) - 1)));
  return {
    kind: e.kind,
    leave: e.kind === "leave" && e.subtype ? e.subtype : "annual",
    title: e.title,
    allDay: e.all_day,
    startDate: start.date,
    startTime: e.all_day ? "10:00" : start.time,
    endDate: e.all_day ? lastDay : end.date,
    endTime: e.all_day ? "11:00" : end.time,
    roomId: e.room_id ?? "",
    showRoom: !!e.room_id || e.kind === "meeting",
    location: e.location ?? "",
    showPlace: !!e.location || e.kind === "outside",
    showPeople: hasPeopleByDefault(e.kind) || e.attendees.length > 1,
    channelId: e.channel_id ?? "",
    showChannel: !!e.channel_id,
    visibility: e.visibility,
    reminders: e.attendees.find((a) => a.user_id === myId)?.remind_minutes ?? [],
    description: e.description ?? "",
  };
}

export default function EventEditor(props: EditorProps) {
  const { openPanel, closePanel } = useWorkspace();
  const [myId, setMyId] = useState<string | null>(null);
  const [me, setMe] = useState<Person | null>(null);
  const [editing, setEditing] = useState<EventWithAttendees | null>(null);
  const [form, setForm] = useState<Form | null>(props.mode === "new" ? newForm(props.date, props.time) : null);
  const [people, setPeople] = useState<Person[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [busy, setBusy] = useState<BusySlot[]>([]);
  const [busyError, setBusyError] = useState(false);
  const [orgChannels, setOrgChannels] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { channels } = useMyChannels();

  const key = props.mode === "new" ? `new:${props.date}:${props.time ?? ""}:${(props.withIds ?? []).join(",")}` : `edit:${props.eventId}`;

  // 열 때 한 번: 나, 회의실, 부서 채널, (고치기면) 일정, (with 가 있으면) 참석자
  useEffect(() => {
    let alive = true;
    setError(null);
    void cachedRooms().then((r) => alive && setRooms(r), () => {});
    void listOrgChannelIds().then((ids) => alive && setOrgChannels(ids), () => {});
    void getMyId().then(async (id) => {
      if (!alive) return;
      setMyId(id);
      void getPeople([id]).then(([p]) => alive && setMe(p ?? null), () => {});
      if (props.mode === "edit") {
        const e = await getEvent(props.eventId);
        if (!alive) return;
        if (!e) {
          setError("일정을 찾을 수 없습니다");
          return;
        }
        setEditing(e);
        setForm(editForm(e, id));
        const others = e.attendees.map((a) => a.user_id).filter((u) => u !== id);
        setPeople(others.length ? await getPeople(others).catch(() => []) : []);
      } else {
        setForm(newForm(props.date, props.time));
        const withIds = (props.withIds ?? []).filter((u) => u !== id);
        setPeople(withIds.length ? await getPeople(withIds).catch(() => []) : []);
      }
    }, (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // 패널을 새 날짜·다른 일정으로 다시 열 때만 (props 는 key 에 모두 들어 있다)
  }, [key]);

  // 회의실을 고르면 그날 예약된 시간대 (고치는 중이면 이 일정이 원래 차지하던 자리는 뺀다)
  const canRoom = form ? form.kind === "meeting" || form.kind === "work" : false;
  const roomId = form && canRoom && form.showRoom ? form.roomId : "";
  const date = form?.startDate ?? "";
  useEffect(() => {
    if (!roomId || !date) {
      setBusy([]);
      return;
    }
    let alive = true;
    const from = fromKstInput(date, "00:00");
    setBusyError(false);
    void roomBusy(roomId, from, addDays(from, 1)).then(
      (slots) => {
        if (!alive) return;
        setBusy(
          editing && editing.room_id === roomId
            ? slots.filter((b) => !(toMs(b.starts_at) === toMs(editing.starts_at) && toMs(b.ends_at) === toMs(editing.ends_at)))
            : slots,
        );
      },
      () => {
        if (alive) {
          setBusy([]);
          setBusyError(true);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [roomId, date, editing]);

  const channelOptions = useMemo(() => (channels ?? []).filter((c) => c.type !== "dm" && c.id !== GENERAL_ID), [channels]);

  if (!form) return error ? <p className={s.error}>{error}</p> : <p className={s.hint}>불러오는 중…</p>;

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const withPeople = hasPeopleByDefault(form.kind) || (form.kind === "outside" && form.showPeople);
  const peopleLabel = form.kind === "work" ? "담당자" : form.kind === "outside" ? "동행" : "참석자";

  function changeKind(kind: EventKind) {
    const f = form!;
    set({
      kind,
      allDay: kind === "leave" ? true : f.kind === "leave" ? false : f.allDay,
      endDate: kind === "leave" ? f.startDate : f.endDate,
      showRoom: kind === "meeting" ? true : kind === "work" ? f.showRoom && !!f.roomId : false,
      showPlace: kind === "outside" ? true : kind === "leave" ? false : f.showPlace && !!f.location,
      showPeople: hasPeopleByDefault(kind) ? true : kind === "outside" ? people.length > 0 : false,
      showChannel: (kind === "meeting" || kind === "work") && f.showChannel,
      visibility: defaultVisibility(kind),
      reminders: props.mode === "new" ? defaultReminders(kind, kind === "leave" || f.allDay) : f.reminders,
    });
  }

  /** 휴가 종류 고르기: 반차는 시간(09~13시)으로, 나머지는 종일로 */
  function chooseLeave(leave: string) {
    const f = form!;
    set(
      leave === "half"
        ? { leave, allDay: false, startTime: "09:00", endDate: f.startDate, endTime: "13:00" }
        : { leave, allDay: true, endDate: f.endDate < f.startDate ? f.startDate : f.endDate },
    );
  }

  function changeStart(startDate: string, startTime: string) {
    const f = form!;
    set(f.allDay ? { startDate, endDate: f.endDate < startDate ? startDate : f.endDate } : { startDate, startTime, ...shiftEnd(f, startDate, startTime) });
  }

  const startsAt = form.allDay ? fromKstInput(form.startDate, "00:00") : fromKstInput(form.startDate, form.startTime);
  const endsAt = form.allDay ? fromKstInput(addDaysKey(form.endDate, 1), "00:00") : fromKstInput(form.endDate, form.endTime);
  const timeOk = !!form.startDate && !!form.endDate && endsAt > startsAt;
  const fallbackTitle = form.kind === "leave" ? subtypeLabel("leave", form.leave) : titleFallback(form.kind);
  const title = form.title.trim() || fallbackTitle;
  const subtype = form.kind === "leave" ? form.leave : detectSubtype(form.kind, title);
  const valid = title.length > 0 && [...title].length <= TITLE_MAX && timeOk;
  const sameDay = form.startDate === form.endDate;

  // 회의실 막대 (08~21시, 하루 안의 일정만)
  const span = (HOUR_END - HOUR_START) * 60;
  const pct = (min: number) => Math.min(100, Math.max(0, ((min - HOUR_START * 60) / span) * 100));
  const conflict = !form.allDay && busy.some((b) => toMs(b.starts_at) < endsAt.getTime() && toMs(b.ends_at) > startsAt.getTime());

  async function save() {
    if (!valid || !form || saving) return;
    setSaving(true);
    setError(null);
    const input: EventInput = {
      title,
      description: form.description || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      room_id: canRoom && form.showRoom && form.roomId ? form.roomId : null,
      // 참석자 칸이 없는 유형(개인·휴가)으로 고쳐도 원래 참석자는 그대로 둔다 (말없이 지우면 그 사람들 캘린더에서 사라진다)
      attendee_ids: withPeople ? people.map((p) => p.id) : editing ? editing.attendees.map((a) => a.user_id).filter((u) => u !== myId) : [],
      kind: form.kind,
      subtype,
      all_day: form.allDay,
      location: form.showPlace && form.kind !== "leave" ? form.location : null,
      visibility: form.visibility,
      channel_id: canRoom && form.showChannel && form.channelId ? form.channelId : null,
      remind_minutes: form.reminders,
    };
    try {
      const saved = editing
        ? await updateEvent(editing.id, input, editing.attendees.map((a) => a.user_id))
        : await createEvent(input);
      bumpCalendar();
      focusCalendarDate(kstDateKey(saved.starts_at));
      openPanel({ kind: "event", eventId: saved.id });
    } catch (e) {
      setError(
        e instanceof RoomConflictError
          ? "회의실이 이미 예약된 시간입니다. 빗금이 없는 시간으로 옮기거나 다른 회의실을 고르세요."
          : e instanceof Error
            ? e.message
            : String(e),
      );
      setSaving(false);
    }
  }

  const adders: { label: string; onClick: () => void }[] = [];
  if (form.kind === "work" && !form.showRoom) adders.push({ label: "+ 회의실", onClick: () => set({ showRoom: true }) });
  if (!form.showPlace && form.kind !== "leave") adders.push({ label: "+ 장소", onClick: () => set({ showPlace: true }) });
  if (form.kind === "outside" && !form.showPeople) adders.push({ label: "+ 동행", onClick: () => set({ showPeople: true }) });
  if (canRoom && !form.showChannel) adders.push({ label: "+ 관련 채널", onClick: () => set({ showChannel: true }) });

  return (
    <form
      className={s.panel}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-label={editing ? "일정 고치기" : "일정 만들기"}
    >
      <div className={s.field}>
        <span className={s.fieldLabel}>유형</span>
        <div className={s.types} role="group" aria-label="유형">
          {KINDS.map((k) => (
            <button key={k.value} type="button" aria-pressed={form.kind === k.value} style={{ ["--c" as string]: colorVar(k.value) }} onClick={() => changeKind(k.value)}>
              {k.label}
            </button>
          ))}
        </div>
        {form.kind === "leave" && (
          <div className={s.subtypes} role="group" aria-label="휴가·부재 종류">
            {KINDS.find((k) => k.value === "leave")!.subtypes.map((st) => (
              <button key={st.value} type="button" aria-pressed={form.leave === st.value} onClick={() => chooseLeave(st.value)}>
                {st.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={s.field}>
        <label className={s.fieldLabel} htmlFor="ev-title">
          제목 (비우면 &quot;{fallbackTitle}&quot;)
        </label>
        <input id="ev-title" type="text" autoFocus maxLength={TITLE_MAX} value={form.title} placeholder={form.kind === "leave" ? `예: ${fallbackTitle}` : titleExamples(form.kind)} onChange={(e) => set({ title: e.target.value })} />
      </div>

      <div className={s.field}>
        <div className={s.inline}>
          <span className={s.fieldLabel}>시작</span>
          <label className={s.switch} style={{ marginLeft: "auto" }}>
            <input type="checkbox" checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked, ...(editing ? {} : { reminders: defaultReminders(form.kind, e.target.checked) }) })} />
            종일
          </label>
        </div>
        <div className={s.inline}>
          <input type="date" aria-label="시작 날짜" value={form.startDate} onChange={(e) => e.target.value && changeStart(e.target.value, form.startTime)} />
          {!form.allDay && <TimeSelect label="시작" value={form.startTime} onChange={(v) => changeStart(form.startDate, v)} />}
        </div>
        <span className={s.fieldLabel}>{form.kind === "work" ? "종료 (마감)" : "종료"}</span>
        <div className={s.inline}>
          <input type="date" aria-label="종료 날짜" min={form.startDate} value={form.endDate} onChange={(e) => e.target.value && set({ endDate: e.target.value })} />
          {!form.allDay && <TimeSelect label="종료" value={form.endTime} onChange={(v) => set({ endTime: v })} />}
        </div>
        {!timeOk && <p className={`${s.hint} ${s.bad}`}>종료가 시작보다 늦어야 합니다.</p>}
      </div>

      {canRoom && form.showRoom && (
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor="ev-room">
            회의실
          </label>
          <select id="ev-room" value={form.roomId} onChange={(e) => set({ roomId: e.target.value })}>
            <option value="">회의실 없음</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.capacity ? ` · ${r.capacity}명` : ""}
                {r.location ? ` · ${r.location}` : ""}
              </option>
            ))}
          </select>
          {form.roomId && !form.allDay && sameDay && (
            <>
              <div className={s.bar} aria-hidden="true">
                {busy.map((b) => (
                  <span
                    key={b.starts_at}
                    className={s.barBusy}
                    style={{ left: `${pct(kstMinuteOfDay(b.starts_at))}%`, width: `${Math.max(1, pct(kstMinuteOfDay(b.ends_at)) - pct(kstMinuteOfDay(b.starts_at)))}%` }}
                  />
                ))}
                <span
                  className={`${s.barMine} ${conflict ? s.conflict : ""}`}
                  style={{ left: `${pct(toMinutes(form.startTime))}%`, width: `${Math.max(1, pct(toMinutes(form.endTime)) - pct(toMinutes(form.startTime)))}%` }}
                />
              </div>
              <div className={s.barScale} aria-hidden="true">
                {[8, 10, 12, 14, 16, 18, 20].map((h) => (
                  <span key={h}>{String(h).padStart(2, "0")}</span>
                ))}
              </div>
            </>
          )}
          {form.roomId && (
            <p className={`${s.hint} ${conflict ? s.bad : ""}`}>
              {busyError
                ? "예약 현황을 불러오지 못했습니다 (저장할 때 겹치면 막힙니다)"
                : conflict
                  ? "이 시간은 이미 예약돼 있습니다. 다른 시간이나 회의실을 고르세요."
                  : busy.length === 0
                    ? "시작일에 예약 없음"
                    : `시작일에 예약된 시간: ${busy.map((b) => `${formatKstTime(b.starts_at)}~${formatKstTime(b.ends_at)}`).join(", ")} (누구의 회의인지는 보이지 않습니다)`}
            </p>
          )}
        </div>
      )}

      {form.showPlace && form.kind !== "leave" && (
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor="ev-place">
            {form.kind === "outside" ? "장소 · 거래처" : "장소"}
          </label>
          <input
            id="ev-place"
            type="text"
            maxLength={LOCATION_MAX}
            value={form.location}
            placeholder={form.kind === "outside" ? "예: 판교 A사" : "예: 3층 라운지"}
            onChange={(e) => set({ location: e.target.value })}
          />
        </div>
      )}

      {withPeople && (
        <div className={s.field}>
          <span className={s.fieldLabel}>
            {peopleLabel} {people.length + 1}명
          </span>
          {/* 만든 사람은 DB(create_event)가 항상 참석자로 넣는다 → × 없는 이름표 */}
          <PeoplePicker value={people} onChange={setPeople} exclude={myId ? [myId] : []} fixed={me ? [{ person: me, note: "· 만든 사람" }] : []} />
          <p className={s.hint}>저장하면 초대 알림이 갑니다. 다른 사람의 일정은 보이지 않습니다.</p>
        </div>
      )}

      {canRoom && form.showChannel && (
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor="ev-channel">
            관련 채널
          </label>
          <select id="ev-channel" value={form.channelId} onChange={(e) => set({ channelId: e.target.value })}>
            <option value="">없음</option>
            {channelOptions.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
                {orgChannels.has(c.id) ? " (부서 채널)" : ""}
              </option>
            ))}
          </select>
          <p className={s.hint}>일반 채널을 고르면, 한 팀 전원이 참석하지 않는 한 프로젝트 일정으로 분류됩니다.</p>
        </div>
      )}

      {adders.length > 0 && (
        <div className={s.adders}>
          {adders.map((a) => (
            <button key={a.label} type="button" onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {form.kind === "meeting" ? (
        <p className={s.note}>회의는 참석자에게만 보입니다.</p>
      ) : (
        <div className={s.field}>
          <span className={s.fieldLabel}>같은 부서 팀원에게</span>
          <div className={s.radio}>
            {VISIBILITIES.map((v) => (
              <label key={v.value}>
                <input type="radio" name="ev-visibility" checked={form.visibility === v.value} onChange={() => set({ visibility: v.value })} />
                <span>
                  {v.label}
                  {v.value === defaultVisibility(form.kind) ? " (기본)" : ""}
                  <small>{teamPreview(form.kind, v.value, subtype)}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className={s.field}>
        <span className={s.fieldLabel}>알림 (나에게)</span>
        <div className={s.chips}>
          {form.reminders.length === 0 && <span className={s.hint}>없음</span>}
          {[...form.reminders]
            .sort((a, b) => a - b)
            .map((m) => (
              <span key={m} className={s.pill}>
                {reminderLabel(m)}
                <button type="button" aria-label={`${reminderLabel(m)} 알림 빼기`} onClick={() => set({ reminders: form.reminders.filter((x) => x !== m) })}>
                  ×
                </button>
              </span>
            ))}
          {form.reminders.length < REMINDERS.length && (
            <select className={s.inlineSelect} aria-label="알림 추가" value="" onChange={(e) => e.target.value && set({ reminders: [...form.reminders, Number(e.target.value)] })}>
              <option value="">+ 알림 추가</option>
              {REMINDERS.filter((r) => !form.reminders.includes(r.minutes)).map((r) => (
                <option key={r.minutes} value={r.minutes}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className={s.hint}>알림함·토스트·브라우저 알림으로 옵니다. 참석자는 각자 자기 알림 시각을 바꿀 수 있습니다.</p>
      </div>

      <div className={s.field}>
        <label className={s.fieldLabel} htmlFor="ev-desc">
          상세 내용
        </label>
        <textarea id="ev-desc" rows={3} maxLength={DESCRIPTION_MAX} value={form.description} placeholder="안건, 준비물, 링크" onChange={(e) => set({ description: e.target.value })} />
      </div>

      {(form.kind === "meeting" || form.kind === "work") && (
        <p className={s.note}>
          분류는 저장할 때 정해집니다. 한 조직(하위 조직 포함) 사람이 모두 참석자면 팀 일정, 아니고 일반 채널을 골랐으면 프로젝트 일정, 나머지는 내 일정입니다.
        </p>
      )}

      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      <div className={s.foot}>
        <span className={s.grow}>{!editing && withPeople && people.length > 0 ? `${peopleLabel} ${people.length}명에게 초대 알림이 갑니다` : ""}</span>
        <button type="button" className={s.secondary} onClick={() => (editing ? openPanel({ kind: "event", eventId: editing.id }) : closePanel())}>
          취소
        </button>
        <button type="submit" className={s.primary} disabled={!valid || saving}>
          {saving ? "저장 중…" : editing ? "고치기" : "저장"}
        </button>
      </div>
    </form>
  );
}
