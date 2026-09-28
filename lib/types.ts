export type ChatMessage = {
  id: number;
  client_id: string;
  author: string;
  body: string;
  created_at: string;
};

/** 서버 저장 전, 화면에만 있는 메시지 */
export type PendingMessage = {
  clientId: string;
  author: string;
  body: string;
  status: "sending" | "failed";
  error?: string;
};

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
