"use client";

// ① 메시지 옆 "안 읽은 사람 수"와 내 읽음 기록 (TECH_SPEC 7절 "읽음·미읽음").
// 채널 멤버와 멤버별 읽음 위치(read_positions)를 받아 두고 실시간으로 갱신한다.
// 채널 목록의 미읽음 배지(②)는 같은 read_positions 를 따로 구독한다 (구독은 영역마다 따로 연다).

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type ReadRow = { user_id: string; last_read_message_id: number };

export function useReadStatus(channelId: string, selfId: string | null) {
  const [members, setMembers] = useState<string[]>([]);
  /** 멤버 id → 마지막으로 읽은 메시지 id */
  const [positions, setPositions] = useState<Record<string, number>>({});
  // 서버에 이미 보낸 내 읽음 위치. 이보다 작은 값은 다시 보내지 않는다 (DB 도 뒤로 가지 않는다)
  const reportedRef = useRef(0);

  const raise = useCallback((rows: ReadRow[]) => {
    if (rows.length === 0) return;
    setPositions((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.user_id] = Math.max(next[r.user_id] ?? 0, Number(r.last_read_message_id));
      return next;
    });
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    let alive = true;
    setMembers([]);
    setPositions({});
    reportedRef.current = 0;

    async function load() {
      const [m, r] = await Promise.all([
        supabase.from("memberships").select("user_id").eq("channel_id", channelId),
        supabase.from("read_positions").select("user_id, last_read_message_id").eq("channel_id", channelId),
      ]);
      if (!alive) return;
      if (m.data) setMembers(m.data.map((x) => x.user_id));
      if (r.data) raise(r.data as ReadRow[]);
    }

    const channel = supabase
      .channel(`reads:${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "read_positions", filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const row = payload.new as Partial<ReadRow>;
          if (row.user_id) raise([row as ReadRow]);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "memberships", filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const id = (payload.new as { user_id: string }).user_id;
          setMembers((prev) => (prev.includes(id) ? prev : [...prev, id]));
        },
      )
      // DELETE 는 필터를 걸 수 없어서 전부 받고 거른다 (기본 키만 온다)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "memberships" }, (payload) => {
        const old = payload.old as { channel_id?: string; user_id?: string };
        if (old.channel_id === channelId && old.user_id) {
          setMembers((prev) => prev.filter((id) => id !== old.user_id));
        }
      })
      .subscribe((status) => {
        // 구독 전·끊긴 동안 바뀐 것은 다시 불러와 맞춘다
        if (status === "SUBSCRIBED") void load();
      });

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [channelId, raise]);

  // 내 위치가 먼저 불러와졌으면 그보다 작은 값은 보내지 않는다
  useEffect(() => {
    if (selfId && positions[selfId]) reportedRef.current = Math.max(reportedRef.current, positions[selfId]);
  }, [selfId, positions]);

  /** 화면에 보인 마지막 메시지까지 읽었다고 남긴다 */
  const markRead = useCallback(
    (messageId: number) => {
      if (!selfId || messageId <= reportedRef.current) return;
      const before = reportedRef.current;
      reportedRef.current = messageId;
      raise([{ user_id: selfId, last_read_message_id: messageId }]);
      // supabase-js 요청은 then 을 불러야 실제로 나간다 (void 만 붙이면 보내지 않는다)
      void getSupabase()
        .rpc("mark_read", { p_channel_id: channelId, p_message_id: messageId })
        .then(({ error }) => {
          // 실패하면 다음에 다시 보내도록 되돌린다
          if (error && reportedRef.current === messageId) reportedRef.current = before;
        });
    },
    [channelId, selfId, raise],
  );

  /** 작성자를 뺀 멤버 가운데 아직 이 메시지까지 읽지 않은 사람 수 */
  const unreadCount = useCallback(
    (messageId: number, authorId: string | null) =>
      members.filter((id) => id !== authorId && (positions[id] ?? 0) < messageId).length,
    [members, positions],
  );

  return { markRead, unreadCount };
}
