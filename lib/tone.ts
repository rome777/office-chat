// ① 말투 변환 모드. 입력창(화면)과 /api/ai/tone(서버)이 같이 쓴다 (PRD F6).

export const TONE_MODES = {
  royal: { label: "신하", hint: "임금께 아뢰는 신하 말투" },
  scholar: { label: "선비", hint: "점잖은 선비 말투" },
  polite: { label: "정중", hint: "요즘 회사의 정중한 존댓말" },
} as const;

export type ToneMode = keyof typeof TONE_MODES;

export const isToneMode = (v: unknown): v is ToneMode => typeof v === "string" && v in TONE_MODES;
