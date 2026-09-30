"use client";

// ② 회의실 예약 (/rooms, 2026-09-30 일정 개편에서 /calendar#rooms 를 옮김).
// 회의실별 하루 예약 현황(RoomBoard) + [회의실 예약](예전 회의 만들기 폼 EventForm).
// 예약도 결국 유형 "회의" 일정이라 일정 화면에도 뜬다. 겹침은 DB 제약 하나가 막는다.
// /rooms?new=1 은 예약 폼을 바로 연다 (대시보드 빠른 실행 "회의실").

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Room } from "@/lib/types/calendar";
import EventForm from "./EventForm";
import RoomBoard from "./RoomBoard";
import { bumpCalendar } from "./calendarBus";
import { getMyId, listRooms } from "./source";
import { kstDateKey } from "./time";
import cal from "./calendar.module.css";
import s from "./schedule.module.css";

export default function RoomsView() {
  const router = useRouter();
  const params = useSearchParams();
  const [myId, setMyId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [date, setDate] = useState(() => kstDateKey(new Date()));
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    void getMyId().then(setMyId, fail);
    void listRooms().then(setRooms, fail);
  }, []);

  useEffect(() => {
    if (params.get("new") !== "1") return;
    router.replace("/rooms", { scroll: false });
    setOpen(true);
  }, [params, router]);

  return (
    <div className={s.roomsPage}>
      <header className={s.roomsHead}>
        <h1>회의실 예약</h1>
        <button type="button" className={s.primary} disabled={!myId} onClick={() => setOpen(true)}>
          회의실 예약
        </button>
      </header>
      {error && (
        <p className={s.error} role="alert">
          불러오지 못했습니다: {error}
        </p>
      )}
      {saved && (
        <p className={s.note} role="status">
          예약했습니다. <Link href={`/calendar?e=${encodeURIComponent(saved)}`} className="link">일정에서 보기</Link>
        </p>
      )}
      <RoomBoard rooms={rooms} date={date} onDateChange={setDate} version={version} />
      {open && myId && rooms.length > 0 && (
        <EventForm
          rooms={rooms}
          myId={myId}
          initialAttendees={[]}
          defaultDate={date}
          defaultRoomId={rooms[0]?.id}
          heading="회의실 예약"
          onClose={() => setOpen(false)}
          onSaved={(id) => {
            setOpen(false);
            setSaved(id);
            setVersion((v) => v + 1);
            bumpCalendar();
          }}
        />
      )}
      <p className={cal.hint}>빗금·회색 칸은 이미 예약된 시간입니다. 누구의 무슨 회의인지는 보이지 않습니다.</p>
    </div>
  );
}
