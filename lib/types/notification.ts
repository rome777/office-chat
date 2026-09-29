// ③ 알림 영역의 타입 (TECH_SPEC 4절 `notifications`)

export type NotificationType =
  | "dm"
  | "mention"
  | "thread_reply"
  | "event_invite"
  | "event_update"
  | "event_cancel"
  | "event_reminder";

export type AppNotification = {
  id: number;
  user_id: string;
  type: NotificationType;
  channel_id: string | null;
  message_id: number | null;
  event_id: string | null;
  created_at: string;
  read_at: string | null;
};
