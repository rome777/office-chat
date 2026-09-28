import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Vercel 의 Supabase 연동은 키 이름을 ANON_KEY 또는 PUBLISHABLE_KEY 로 넣는다. 둘 다 받는다.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !key) {
    throw new Error(
      "Supabase 환경 변수가 없습니다. `npx vercel env pull .env.local` 로 받아 오세요.",
    );
  }
  client ??= createClient(url, key, { auth: { persistSession: false } });
  return client;
}
