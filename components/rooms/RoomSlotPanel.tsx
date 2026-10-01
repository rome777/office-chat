"use client";

// ② 남의 회의실 예약 (오른쪽 패널, PanelState roomSlot). DB room_board 가 준 칸만 보인다:
//   공개 회의 — 시각 · 예약자 이름 · 부서 + [메시지 보내기](DM) / 비공개 회의 — 시각만 (예약자는 참석자에게만, 관리자에게도 숨김)

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Room } from "@/lib/types/calendar";
import PersonAvatar from "@/components/profile/PersonAvatar";
import { startDm } from "@/components/sidebar/channelSource";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { cachedRooms } from "@/components/calendar/EventPanel";
import { formatKstRange, kstDateKey, kstMinuteOfDay, toMs } from "@/components/calendar/time";
import cal from "@/components/calendar/schedule.module.css";
import { ROOM_POLICY, durationText, hm } from "./policy";

export default function RoomSlotPanel({
  roomId,
  startsAt,
  endsAt,
  isPrivate,
  bookerId,
  bookerName,
  bookerUnit,
}: {
  roomId: string;
  startsAt: string;
  endsAt: string;
  isPrivate: boolean;
  bookerId: string | null;
  bookerName: string | null;
  bookerUnit: string | null;
}) {
  const router = useRouter();
  const { openPanel } = useWorkspace();
  const [room, setRoom] = useState<Room | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void cachedRooms().then((list) => alive && setRoom(list.find((r) => r.id === roomId) ?? null), () => {});
    return () => {
      alive = false;
    };
  }, [roomId]);

  const after = kstMinuteOfDay(endsAt) || 24 * 60;
  const canFollow = after + ROOM_POLICY.slot <= ROOM_POLICY.close && toMs(endsAt) > Date.now();

  async function message() {
    if (!bookerId) return;
    setWorking(true);
    setError(null);
    try {
      const ch = await startDm(bookerId);
      router.push(`/chat?c=${encodeURIComponent(ch)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorking(false);
    }
  }

  return (
    <div className={cal.panel}>
      <h3 className={cal.detailTitle}>{isPrivate ? "비공개 예약" : "회의실 예약"}</h3>
      <div className={cal.rows}>
        <div className={cal.kv}>
          <span>회의실</span>
          <span>{room ? `${room.name}${room.capacity ? ` · ${room.capacity}명` : ""}${room.location ? ` · ${room.location}` : ""}` : "회의실"}</span>
        </div>
        <div className={cal.kv}>
          <span>시간</span>
          <span>
            {formatKstRange(startsAt, endsAt)} ({durationText(Math.round((toMs(endsAt) - toMs(startsAt)) / 60000))})
          </span>
        </div>
        <div className={cal.kv}>
          <span>예약자</span>
          {isPrivate || !bookerName ? (
            <span>비공개</span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {bookerId && <PersonAvatar userId={bookerId} name={bookerName} size={24} />}
              {bookerName}
              {bookerUnit ? ` · ${bookerUnit}` : ""}
            </span>
          )}
        </div>
      </div>
      <p className={cal.note}>
        {isPrivate ? "비공개 회의라 예약자와 회의 내용은 참석자에게만 보입니다." : "회의 제목·참석자·메모는 참석자에게만 보입니다."}
      </p>
      {error && (
        <p className={cal.error} role="alert">
          {error}
        </p>
      )}
      <div className={cal.chips}>
        {!isPrivate && bookerId && (
          <button type="button" className={cal.primary} disabled={working} onClick={() => void message()}>
            {bookerName} 님에게 메시지
          </button>
        )}
        {canFollow && (
          <button
            type="button"
            className={cal.secondary}
            onClick={() =>
              openPanel({ kind: "roomBook", roomId, date: kstDateKey(endsAt), start: hm(after), end: hm(Math.min(ROOM_POLICY.close, after + 60)) })
            }
          >
            끝난 뒤 {hm(after)}부터 예약
          </button>
        )}
      </div>
    </div>
  );
}
