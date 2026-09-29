// AI 공통 — 요청 상한과 기록 (서버 전용, TECH_SPEC 8절 규칙 7).
// 모든 AI 요청을 ai_usage_logs 에 남기고, 그 기록을 세어서 사용자당 분당·하루 상한을 검사한다.
// 사용자 토큰으로 조회·기록한다 → RLS 가 본인 기록만 보게 한다.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AiFeature = "summarize" | "todos" | "tone";
export type AiStatus = "ok" | "error" | "timeout" | "rate_limited" | "denied";

export const AI_LIMITS = { perMinute: 5, perDay: 100 };

/** 상한을 넘었으면 화면에 보여 줄 문구, 아니면 null. 실제로 AI 를 부른 요청(ok·error·timeout)만 센다 */
export async function overLimit(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const count = async (sinceMs: number) => {
    const { count } = await supabase
      .from("ai_usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["ok", "error", "timeout"])
      .gte("created_at", new Date(Date.now() - sinceMs).toISOString());
    return count ?? 0;
  };
  if ((await count(60_000)) >= AI_LIMITS.perMinute) return `AI 는 1분에 ${AI_LIMITS.perMinute}번까지 쓸 수 있습니다. 잠시 뒤 다시 시도해 주세요`;
  if ((await count(86_400_000)) >= AI_LIMITS.perDay) return `AI 는 하루에 ${AI_LIMITS.perDay}번까지 쓸 수 있습니다`;
  return null;
}

export async function logUsage(
  supabase: SupabaseClient,
  row: { feature: AiFeature; status: AiStatus; input_tokens?: number; output_tokens?: number },
) {
  // user_id 는 기본값 auth.uid() 로 들어간다 (컬럼 권한상 보낼 수 없다)
  const { error } = await supabase.from("ai_usage_logs").insert({
    feature: row.feature,
    status: row.status,
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
  });
  if (error) console.error("ai_usage_logs 기록 실패:", error.message);
}
