"use client";

// ① 이 채널에 새 글을 쓸 수 있나. 공지 채널(channels.notice_unit_id 가 있는 채널, 2026-10-01 WU-45)은
// 담당 부서·리더·부리더·관리자만 새 글을 쓴다. 막는 것은 DB 트리거(messages_check_notice)이고,
// 이 훅은 쓸 수 없는 사람에게 입력창 대신 안내를 보여 주려고 본다. 답글은 누구나 쓰므로 스레드 입력창은 그대로 둔다.

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type PostRight = {
  channelId: string;
  /** 공지 채널인가 */
  notice: boolean;
  canPost: boolean;
  /** 공지 담당 부서 이름 (안내 문구용) */
  unitName: string | null;
};

const OPEN = (channelId: string): PostRight => ({ channelId, notice: false, canPost: true, unitName: null });

export function usePostRight(channelId: string): PostRight {
  const [right, setRight] = useState<PostRight>(() => OPEN(channelId));

  useEffect(() => {
    let alive = true;
    const supabase = getSupabase();
    void (async () => {
      // notice_unit_id 칸이 아직 없는 DB(마이그레이션 전)면 오류가 난다 → 보통 채널로 본다
      const { data: ch, error } = await supabase.from("channels").select("notice_unit_id").eq("id", channelId).maybeSingle();
      if (!alive) return;
      if (error || !ch?.notice_unit_id) return setRight(OPEN(channelId));
      const [{ data: can }, { data: unit }] = await Promise.all([
        supabase.rpc("can_post_in", { p_channel: channelId }),
        supabase.from("org_units").select("name").eq("id", ch.notice_unit_id).maybeSingle(),
      ]);
      if (!alive) return;
      setRight({ channelId, notice: true, canPost: can !== false, unitName: unit?.name ?? null });
    })();
    return () => {
      alive = false;
    };
  }, [channelId]);

  // 채널을 바꾼 직후에는 새 채널 결과가 오기 전까지 보통 채널로 본다 (앞 채널의 결과를 쓰지 않는다)
  return right.channelId === channelId ? right : OPEN(channelId);
}
