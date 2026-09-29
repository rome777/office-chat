// AI 공통 — OpenAI 호출 (서버 전용, TECH_SPEC 8절). 요약·할 일(③)과 말투 변환(①)이 같이 쓴다.
// SDK 를 넣지 않고 REST API 를 fetch 로 부른다 (패키지 추가는 팀 합의가 필요해서).
//
// 환경 변수는 OPENAI_API_KEY 하나다 (.env.local·Vercel, 서버만).

export const AI_TIMEOUT_MS = 20_000; // TECH_SPEC 8절 규칙 6
const MODEL = "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export type AiErrorKind = "no_key" | "timeout" | "bad_key" | "provider_limit" | "failed";

/** 화면에 그대로 보여 줄 수 있는 문구를 가진 오류 */
export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type AiResult = { text: string; inputTokens: number; outputTokens: number };

export async function complete({
  system,
  user,
  maxTokens = 800,
  json = false,
}: {
  system: string;
  user: string;
  maxTokens?: number;
  /** true 면 JSON 객체로만 답하게 한다 */
  json?: boolean;
}): Promise<AiResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError("no_key", "AI 키가 설정되지 않았습니다 (OPENAI_API_KEY)");

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_completion_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") throw new AiError("timeout", "AI 응답이 늦습니다. 잠시 뒤 다시 시도해 주세요");
    throw new AiError("failed", "AI 서버에 연결하지 못했습니다");
  }

  if (!res.ok) {
    if (res.status === 401) throw new AiError("bad_key", "AI 키가 올바르지 않습니다");
    if (res.status === 429) throw new AiError("provider_limit", "AI 제공자의 요청 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요");
    const detail = await res.text().catch(() => "");
    throw new AiError("failed", `AI 요청이 실패했습니다 (${res.status}) ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";
  const inputTokens = Number(data.usage?.prompt_tokens ?? 0);
  const outputTokens = Number(data.usage?.completion_tokens ?? 0);
  return { text: text.trim(), inputTokens, outputTokens };
}
