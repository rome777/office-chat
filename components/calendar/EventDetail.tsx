"use client";

// ② 회의 상세. 참석자별 응답, 초대받은 사람은 수락·거절, 만든 사람은 고치기·취소.

import { useState } from "react";
import type { AttendeeResponse, Room } from "@/lib/types/calendar";
import type { Person } from "@/lib/types/people";
import { cancelEvent, respond, type EventWithAttendees } from "./source";
import { formatKstRange } from "./time";
import s from "./calendar.module.css";

const RESPONSE_LABEL: Record<AttendeeResponse, string> = {
  accepted: "수락",
  declined: "거절",
  pending: "응답 전",
};

export default function EventDetail({
  event,
  rooms,
  people,
  myId,
  onClose,
  onEdit,
  onChanged,
}: {
  event: EventWithAttendees;
  rooms: Room[];
  people: Map<string, Person>;
  myId: string;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const room = rooms.find((r) => r.id === event.room_id);
  const mine = event.attendees.find((a) => a.user_id === myId);
  const isCreator = event.created_by === myId;
  const canceled = event.canceled_at !== null;
  const nameOf = (id: string) => people.get(id)?.display_name ?? "알 수 없는 사람";

  async function run(action: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={s.backdrop} onClick={onClose}>
      <section
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="회의 상세"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2 className={canceled ? s.struck : undefined}>{event.title}</h2>
        {canceled && <p className={s.badgeBad}>취소된 회의</p>}
        <p>{formatKstRange(event.starts_at, event.ends_at)}</p>
        <p className="muted">{room ? room.name : "회의실 없음"}</p>
        {event.description && <p className={s.description}>{event.description}</p>}

        <h3>참석자</h3>
        <ul className={s.attendees}>
          {event.attendees.map((a) => (
            <li key={a.user_id}>
              <span>
                {nameOf(a.user_id)}
                {a.user_id === event.created_by && " (만든 사람)"}
                {a.user_id === myId && " · 나"}
              </span>
              <span className={s[`resp_${a.response}`]}>{RESPONSE_LABEL[a.response]}</span>
            </li>
          ))}
        </ul>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        <div className={s.actions}>
          <button type="button" className={s.secondary} onClick={onClose}>
            닫기
          </button>
          {!canceled && mine && !isCreator && (
            <>
              <button
                type="button"
                className={mine.response === "declined" ? s.primary : s.secondary}
                disabled={working || mine.response === "declined"}
                onClick={() => void run(() => respond(event.id, "declined"))}
              >
                거절
              </button>
              <button
                type="button"
                className={mine.response === "accepted" ? s.primary : s.secondary}
                disabled={working || mine.response === "accepted"}
                onClick={() => void run(() => respond(event.id, "accepted"))}
              >
                수락
              </button>
            </>
          )}
          {!canceled && isCreator && (
            <>
              <button
                type="button"
                className={s.danger}
                disabled={working}
                onClick={() => {
                  if (window.confirm("이 회의를 취소할까요? 참석자에게 취소로 보입니다.")) {
                    void run(() => cancelEvent(event.id));
                  }
                }}
              >
                회의 취소
              </button>
              <button type="button" className={s.primary} disabled={working} onClick={onEdit}>
                고치기
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
