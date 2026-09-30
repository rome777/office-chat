"use client";

// ① 지금 채널의 멤버와 그 프로필. 안 읽은 사람 수, @ 자동완성, 멘션 강조(멤버만)가 같이 쓴다.
// 멤버가 들어오고 나가는 것, 리더·부리더가 바뀌는 것은 실시간으로 받는다.

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { newClientId } from "./useMessages";

export type Member = {
  id: string;
  handle: string;
  display_name: string;
  department: string | null;
  title: string | null; // 직급 (@ 자동완성에서 동명이인을 가린다)
  org_unit_id: string | null; // 소속 부서 (@부서 자동완성에서 이 채널의 부서와 인원을 센다)
  role: ChannelRole; // 일반 채널의 리더·부리더 (부서 채널·DM 은 모두 member, 20260930210000_channel_leaders)
  role_at: string | null; // 리더·부리더가 된 시각
};
export type ChannelRole = "leader" | "sub" | "member";
type Profile = Omit<Member, "role" | "role_at">;
const asRole = (v: unknown): ChannelRole => (v === "leader" || v === "sub" ? v : "member");

export function useChannelMembers(channelId: string) {
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    setMembers([]);
    if (!channelId) return; // 아직 어느 채널인지 모른다 (스레드 부모를 불러오는 중)
    const supabase = getSupabase();
    let alive = true;

    async function load() {
      // memberships → profiles 를 FK 로 붙여 한 번에 받는다
      const PROFILE = "profiles(id, handle, display_name, department, title, org_unit_id)";
      let res = await supabase.from("memberships").select(`user_id, role, role_at, ${PROFILE}`).eq("channel_id", channelId);
      // role 칸이 아직 없는 DB(20260930210000_channel_leaders 적용 전)면 역할 없이 읽는다 — 멤버 목록이 비지 않게
      if (res.error) {
        res = (await supabase.from("memberships").select(`user_id, ${PROFILE}`).eq("channel_id", channelId)) as unknown as typeof res;
      }
      const data = res.data;
      if (!alive || !data) return;
      setMembers(
        data
          .map((row) => {
            const p = row.profiles as unknown as Profile | null;
            return p ? { ...p, role: asRole(row.role), role_at: (row.role_at as string | null) ?? null } : null;
          })
          .filter((m): m is Member => !!m)
          .sort((a, b) => a.display_name.localeCompare(b.display_name, "ko")),
      );
    }

    // 구독 이름에 매번 고유한 꼬리를 붙인다. supabase.channel() 은 같은 이름이 있으면 이미 구독한 채널을 돌려주고,
    // 거기에 .on() 을 붙이면 "cannot add postgres_changes callbacks after subscribe()" 로 화면 전체가 멈춘다 (2026-09-29)
    const channel = supabase
      .channel(`members:${channelId}:${newClientId()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "memberships", filter: `channel_id=eq.${channelId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "memberships", filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const row = payload.new as { user_id?: string; role?: string; role_at?: string | null };
          setMembers((prev) => prev.map((m) => (m.id === row.user_id ? { ...m, role: asRole(row.role), role_at: row.role_at ?? null } : m)));
        },
      )
      // DELETE 는 필터를 걸 수 없어서 전부 받고 거른다 (기본 키만 온다)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "memberships" }, (payload) => {
        const old = payload.old as { channel_id?: string; user_id?: string };
        if (old.channel_id === channelId) setMembers((prev) => prev.filter((m) => m.id !== old.user_id));
      })
      .subscribe((status) => {
        // 구독 전·끊긴 동안 바뀐 것은 다시 불러와 맞춘다
        if (status === "SUBSCRIBED") void load();
      });

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [channelId]);

  return members;
}
