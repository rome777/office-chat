import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// 브라우저용 Supabase 클라이언트. 로그인 세션을 쿠키에 담아 서버(proxy.ts)와 같이 쓴다.
// 서버(라우트 핸들러)에서는 lib/supabase-server.ts 를 쓴다.

// Vercel 의 Supabase 연동은 키 이름을 ANON_KEY 또는 PUBLISHABLE_KEY 로 넣는다. 둘 다 받는다.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const MISSING_ENV_MESSAGE =
  "Supabase 환경 변수가 없습니다. `npx vercel env pull .env.local` 로 받아 오세요.";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseUrl || !supabaseKey) throw new Error(MISSING_ENV_MESSAGE);
  client ??= createBrowserClient(supabaseUrl, supabaseKey);
  return client;
}
