// ② 캘린더·회의 예약 영역의 타입 (TECH_SPEC 4절 `rooms`·`events`·`event_attendees`)

export type Room = {
  id: string;
  name: string;
  capacity: number | null;
  location: string | null;
};

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  room_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
};

export type AttendeeResponse = "pending" | "accepted" | "declined";

export type EventAttendee = {
  event_id: string;
  user_id: string;
  response: AttendeeResponse;
  responded_at: string | null;
};
