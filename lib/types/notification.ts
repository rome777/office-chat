// ③ 알림 영역의 타입 (TECH_SPEC 4절 `notifications`)

export type NotificationType =
  | "dm"
  | "mention"
  | "thread_reply"
  | "event_invite"
  | "event_update"
  | "event_cancel"
  | "event_reminder"
  | "event_decline";

export type AppNotification = {
  id: number;
  user_id: string;
  type: NotificationType;
  channel_id: string | null;
  message_id: number | null;
  event_id: string | null;
  /** 알림을 일으킨 사람. 지금은 회의 불참(event_decline)에서 불참한 사람만 채운다 */
  actor_id: string | null;
  created_at: string;
  read_at: string | null;
};
