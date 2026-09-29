import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { MISSING_ENV_MESSAGE, supabaseKey, supabaseUrl } from "./supabase";

// 서버용 Supabase 클라이언트 (라우트 핸들러·서버 컴포넌트). 요청마다 새로 만든다.
// 요청의 로그인 쿠키를 읽고, 세션이 바뀌면 응답 쿠키에 다시 쓴다.
export async function getServerSupabase() {
  if (!supabaseUrl || !supabaseKey) throw new Error(MISSING_ENV_MESSAGE);
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 proxy.ts 가 맡는다
        }
      },
    },
  });
}
