"use client";

// ② 회의실 예약 화면만 쓰는 데이터. 회의실·시간표·예약 저장은 일정과 같은 components/calendar/source.ts 를 쓴다.

import { getSupabase } from "@/lib/supabase";
import { getMyId } from "@/components/calendar/source";

const adminCache = new Map<string, Promise<boolean>>();

/** 관리자면 4시간을 넘겨 예약할 수 있다 (DB 트리거가 같은 기준으로 막는다). 화면 안내에만 쓴다.
 *  로그인한 사람마다 따로 기억한다 (같은 탭에서 계정을 바꿔도 예전 값이 남지 않게) */
export async function amIAdmin(): Promise<boolean> {
  try {
    const id = await getMyId();
    let hit = adminCache.get(id);
    if (!hit) {
      hit = Promise.resolve(getSupabase().from("profiles").select("role").eq("id", id).maybeSingle()).then(({ data }) => data?.role === "admin");
      adminCache.set(id, hit);
      hit.catch(() => adminCache.delete(id));
    }
    return await hit;
  } catch {
    return false;
  }
}
