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
  /** 스레드 답글 수. 답글이 달리면 DB 트리거가 올린다 (최상위 메시지만) */
  reply_count: number;
  last_reply_at: string | null;
};

/** attachments 테이블 한 행 중 화면에 필요한 것. 파일은 /api/attachments/{id} 로 연다 */
export type MessageAttachment = {
  id: string;
  message_id: number;
  mime: string;
  size: number;
  file_name: string;
};

/** 서버 저장 전, 화면에만 있는 메시지 */
export type PendingMessage = {
  clientId: string;
  author: string;
  body: string;
  status: "sending" | "failed";
  error?: string;
  /** 첨부 메시지. "다시 보내기" 때 다시 올리려고 파일을 들고 있는다 (새로고침하면 사라진다) */
  file?: File;
};

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
