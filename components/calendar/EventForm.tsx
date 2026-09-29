"use client";

// ② 회의 만들기·고치기. 회의실을 고르면 그날 예약된 시간대를 보여 준다 (남의 회의 내용은 없이).

import { useEffect, useState } from "react";
import type { Room } from "@/lib/types/calendar";
import type { Person } from "@/lib/types/people";
import PeoplePicker from "@/components/people/PeoplePicker";
import {
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
import s from "./calendar.module.css";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const saved = editing ? await updateEvent(editing.id, input) : await createEvent(input);
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
          <label className={s.field}>
            <span>시작</span>
            <input
              type="time"
              step={300}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </label>
          <label className={s.field}>
            <span>끝</span>
            <input
              type="time"
              step={300}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </label>
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
            {busy.length === 0
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
