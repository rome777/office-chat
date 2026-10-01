// ② 회의실 시설 이름과 아이콘 (DB rooms.facilities 의 값과 같다 — 제약 rooms_facilities)

import type { RoomFacility } from "@/lib/types/calendar";

export const FACILITIES: { value: RoomFacility; label: string }[] = [
  { value: "monitor", label: "모니터" },
  { value: "video", label: "화상회의" },
  { value: "whiteboard", label: "화이트보드" },
  { value: "projector", label: "프로젝터" },
  { value: "mic", label: "마이크" },
];
export const facilityLabel = (f: RoomFacility) => FACILITIES.find((x) => x.value === f)?.label ?? f;

const PATHS: Record<RoomFacility | "people" | "pin", string> = {
  monitor: "M2.5 3.5h15v10h-15zM7 17h6M10 13.5V17",
  video: "M2.5 5.5h11v9h-11zM13.5 9l4-2.5v7l-4-2.5",
  whiteboard: "M2.5 3h15v11h-15zM6 17.5 8 14M14 17.5 12 14M6 7.5c2 1.5 4-1.5 6 0s2 1 3 0",
  projector: "M4.5 7h11a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM5 14v2M15 14v2M13 8.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  mic: "M10 2.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0V5A2.5 2.5 0 0 1 10 2.5zM5 9.5a5 5 0 0 0 10 0M10 14.5v3",
  people: "M7.5 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M14 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13.5 12c2 0 3.5 1.3 3.5 3.5",
  pin: "M10 17.5s5-4.6 5-8.5a5 5 0 0 0-10 0c0 3.9 5 8.5 5 8.5zM10 7.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z",
};

export function RoomGlyph({ name, size = 15 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
