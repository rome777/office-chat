"use client";

// ② 회의 만들기·고치기. 회의실을 고르면 그날 예약된 시간대를 보여 준다 (남의 회의 내용은 없이).

import { useEffect, useState } from "react";
import type { Room } from "@/lib/types/calendar";
import type { Person } from "@/lib/types/people";
import PeoplePicker from "@/components/people/PeoplePicker";
import {
  DESCRIPTION_MAX,
  RoomConflictError,
  TITLE_MAX,
  createEvent,
  roomBusy,
  updateEvent,
  type BusySlot,
  type EventInput,
  type EventWithAttendees,
} from "./source";
import { addDays, formatKstTime, fromKstInput, toKstInput, toMs } from "./time";
import TimeSelect, { fromMinutes, toMinutes } from "./TimeSelect";
import s from "./calendar.module.css";

/** 끝 시각이 따라갈 때 넘지 않는 마지막 칸 (23:55) */
const LAST_SLOT = 23 * 60 + 55;

export default function EventForm({
  rooms,
  myId,
  editing,
  initialAttendees,
  defaultDate,
  onClose,
  onSaved,
}: {
  rooms: Room[];
  myId: string;
  /** 있으면 고치기, 없으면 새로 만들기 */
  editing?: EventWithAttendees;
  initialAttendees: Person[];
  defaultDate: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const start = editing ? toKstInput(editing.starts_at) : { date: defaultDate, time: "10:00" };
  const end = editing ? toKstInput(editing.ends_at) : { date: defaultDate, time: "11:00" };

  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [date, setDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time);
  const [endTime, setEndTime] = useState(end.time);
  const [roomId, setRoomId] = useState(editing?.room_id ?? "");
  const [people, setPeople] = useState<Person[]>(initialAttendees);
  const [busy, setBusy] = useState<BusySlot[]>([]);
  const [busyError, setBusyError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 시작을 바꾸면 끝도 같은 간격만큼 따라간다 (간격이 없거나 거꾸로면 1시간). 하루를 넘기지 않게 23:55 에서 멈춘다
  function changeStart(next: string) {
    const gap = toMinutes(endTime) - toMinutes(startTime);
    const keep = gap > 0 ? gap : 60;
    setStartTime(next);
    setEndTime(fromMinutes(Math.min(toMinutes(next) + keep, LAST_SLOT)));
  }

  const startsAt = date && startTime ? fromKstInput(date, startTime) : null;
  const endsAt = date && endTime ? fromKstInput(date, endTime) : null;
  const timeOk = startsAt && endsAt && endsAt > startsAt;
  const valid = title.trim().length > 0 && title.trim().length <= TITLE_MAX && timeOk;

  useEffect(() => {
    if (!roomId || !date) {
      setBusy([]);
      return;
    }
    let alive = true;
    const dayStart = fromKstInput(date, "00:00");
    setBusyError(false);
    void roomBusy(roomId, dayStart, addDays(dayStart, 1)).then((slots) => {
      if (!alive) return;
      // 고치는 중이면 이 회의가 원래 차지하던 자리는 빼고 보여 준다
      setBusy(
        editing && editing.room_id === roomId
          ? slots.filter(
              (b) =>
                !(
                  toMs(b.starts_at) === toMs(editing.starts_at) &&
                  toMs(b.ends_at) === toMs(editing.ends_at)
                ),
            )
          : slots,
      );
    }, () => {
      // 못 불러왔을 때 "예약 없음"으로 보이면 비어 있다고 오해한다. 저장 때는 DB 가 겹침을 막는다
      if (alive) {
        setBusy([]);
        setBusyError(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [roomId, date, editing]);

  async function save() {
    if (!valid || !startsAt || !endsAt) return;
    setSaving(true);
    setError(null);
    const input: EventInput = {
      title,
      description: description || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      room_id: roomId || null,
      attendee_ids: people.map((p) => p.id),
    };
    try {
      // 고치기는 폼을 열 때의 참석자와 비교한다 — 그 사이 다른 탭에서 넣은 사람을 지우지 않게
      const saved = editing
        ? await updateEvent(editing.id, input, editing.attendees.map((a) => a.user_id))
        : await createEvent(input);
      onSaved(saved.id);
    } catch (e) {
      setError(
        e instanceof RoomConflictError
          ? "이미 예약된 시간입니다. 다른 시간이나 회의실을 골라 주세요."
          : e instanceof Error
            ? e.message
            : String(e),
      );
      setSaving(false);
    }
  }

  return (
    <div className={s.backdrop} onClick={onClose}>
      <form
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "회의 고치기" : "회의 만들기"}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) void save();
        }}
      >
        <h2>{editing ? "회의 고치기" : "회의 만들기"}</h2>

        <label className={s.field}>
          <span>제목</span>
          <input
            autoFocus
            maxLength={TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 주간 기획 회의"
          />
        </label>

        <div className={s.row}>
          <label className={s.field}>
            <span>날짜</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className={s.field} role="group" aria-label="시작 시각">
            <span>시작</span>
            <TimeSelect label="시작" value={startTime} onChange={changeStart} />
          </div>
          <div className={s.field} role="group" aria-label="끝 시각">
            <span>끝</span>
            <TimeSelect label="끝" value={endTime} onChange={setEndTime} />
          </div>
        </div>
        {!timeOk && <p className={s.hint}>끝나는 시각이 시작보다 늦어야 합니다.</p>}

        <label className={s.field}>
          <span>회의실</span>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">회의실 없음</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.capacity ? ` · ${r.capacity}명` : ""}
                {r.location ? ` · ${r.location}` : ""}
              </option>
            ))}
          </select>
        </label>
        {roomId && (
          <p className={s.hint}>
            {busyError
              ? "예약 현황을 불러오지 못했습니다 (저장할 때 겹치면 막힙니다)"
              : busy.length === 0
              ? "이날 예약 없음"
              : `이날 예약된 시간: ${busy
                  .map((b) => `${formatKstTime(b.starts_at)}~${formatKstTime(b.ends_at)}`)
                  .join(", ")}`}
          </p>
        )}

        <div className={s.field}>
          <span>참석자</span>
          <PeoplePicker value={people} onChange={setPeople} exclude={[myId]} />
        </div>

        <label className={s.field}>
          <span>설명 (선택)</span>
          <textarea
            rows={3}
            maxLength={DESCRIPTION_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        <div className={s.actions}>
          <button type="button" className={s.secondary} onClick={onClose}>
            닫기
          </button>
          <button type="submit" className={s.primary} disabled={!valid || saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
