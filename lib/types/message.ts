// ① 가운데(메시지 목록·입력창) 영역의 타입

/** messages 테이블 한 행 (TECH_SPEC 4절) */
export type ChatMessage = {
  id: number;
  client_id: string;
  channel_id: string;
  /** 로그인한 사람. Step 1 익명 메시지는 null */
  user_id: string | null;
  parent_id: number | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  /** Step 1 임시 호환의 닉네임. 로그인한 사람의 메시지는 null (이름은 profiles 에서 찾는다) */
  author: string | null;
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
