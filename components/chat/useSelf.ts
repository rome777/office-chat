"use client";

// ① 나 (로그인한 사람)의 id·handle. 내 메시지 표시와 나를 부른 멘션 강조에 쓴다.
// 로그인 세션은 입장 관문(②)이 이미 확인했다.

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type Self = { id: string; handle: string | null };

export function useSelf(): Self | null {
  const [self, setSelf] = useState<Self | null>(null);

  useEffect(() => {
    let alive = true;
    const supabase = getSupabase();
    void supabase.auth.getSession().then(async ({ data }) => {
      const id = data.session?.user.id;
      if (!id || !alive) return;
      setSelf({ id, handle: null });
      const { data: profile } = await supabase.from("profiles").select("handle").eq("id", id).maybeSingle();
      if (alive) setSelf({ id, handle: profile?.handle ?? null });
    });
    return () => {
      alive = false;
    };
  }, []);

  return self;
}
