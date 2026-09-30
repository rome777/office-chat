"use client";

// ① 메시지 리액션 (message_reactions, 20260930170000_chat_extras.sql).
// 달기·떼기는 toggle_reaction RPC 하나로 한다. 뗀 리액션은 행이 남고 removed_at 이 채워진다 —
// 그래서 실시간은 INSERT·UPDATE 만 받으면 되고, 둘 다 채널로 걸러서 같은 채널 멤버에게만 온다 (RLS).

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { newClientId } from "./useMessages";

export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👏", "🎉", "👌", "✅", "🙏"] as const;

type Row = { message_id: number; user_id: string; emoji: string; removed_at: string | null };

/** 메시지 id → 이모지 → 누른 사람 id 들 */
export type ReactionMap = ReadonlyMap<number, ReadonlyMap<string, ReadonlySet<string>>>;

function apply(prev: ReactionMap, rows: Row[]): ReactionMap {
  const next = new Map(prev as Map<number, Map<string, Set<string>>>);
  for (const r of rows) {
    const byEmoji = new Map(next.get(r.message_id) ?? []);
    const users = new Set(byEmoji.get(r.emoji) ?? []);
    if (r.removed_at) users.delete(r.user_id);
    else users.add(r.user_id);
    if (users.size) byEmoji.set(r.emoji, users);
    else byEmoji.delete(r.emoji);
    if (byEmoji.size) next.set(r.message_id, byEmoji);
    else next.delete(r.message_id);
  }
  return next;
}

/** oldestId: 화면에 받아 둔 가장 오래된 메시지. 그보다 새 메시지의 리액션만 받는다 */
export function useReactions(channelId: string, oldestId: number | null) {
  const [reactions, setReactions] = useState<ReactionMap>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReactions(new Map());
    if (!channelId) return;
    const supabase = getSupabase();
    const live = supabase
      .channel(`reactions:${channelId}:${newClientId()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions", filter: `channel_id=eq.${channelId}` },
        (p) => setReactions((prev) => apply(prev, [p.new as Row])),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "message_reactions", filter: `channel_id=eq.${channelId}` },
        (p) => setReactions((prev) => apply(prev, [p.new as Row])),
      )
      .subscribe();
    return () => void supabase.removeChannel(live);
  }, [channelId]);

  // 받아 둔 범위가 넓어지면(이전 메시지 불러오기) 그 범위의 리액션을 받는다
  useEffect(() => {
    if (!channelId || oldestId === null) return;
    let alive = true;
    void getSupabase()
      .from("message_reactions")
      .select("message_id, user_id, emoji, removed_at")
      .eq("channel_id", channelId)
      .gte("message_id", oldestId)
      .is("removed_at", null)
      .limit(5000)
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) return setError(e.message); // 마이그레이션 전이면 리액션 없이 보인다
        setReactions((prev) => apply(prev, (data ?? []) as Row[]));
      });
    return () => {
      alive = false;
    };
  }, [channelId, oldestId]);

  const toggle = useCallback(async (messageId: number, emoji: string) => {
    const { error: e } = await getSupabase().rpc("toggle_reaction", { p_message: messageId, p_emoji: emoji });
    if (e) throw new Error(e.message);
  }, []);

  return { reactions, toggle, error };
}
