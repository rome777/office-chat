"use client";

// ② 내가 가입한 채널 목록. 채널을 만들거나 가입하면 쓰는 곳 모두 함께 갱신된다.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChannelSummary, DmSummary } from "@/lib/types/channel";
import { listMyChannels, listMyDms, subscribeChannels } from "./channelSource";
import { getUnread, subscribeUnread } from "./unread";

export function useMyChannels(): { channels: ChannelSummary[] | null; error: string | null } {
  const [channels, setChannels] = useState<ChannelSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // 늦게 끝난 옛 요청이 새 결과를 덮지 않게, 마지막에 보낸 요청의 결과만 쓴다
    let latest = 0;
    const load = () => {
      const seq = ++latest;
      void listMyChannels().then(
        (list) => {
          if (!alive || seq !== latest) return;
          setChannels(list);
          setError(null);
        },
        (e: unknown) => {
          if (alive && seq === latest) setError(e instanceof Error ? e.message : String(e));
        },
      );
    };
    load();
    const unsubscribe = subscribeChannels(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return { channels, error };
}

/** 내 DM 목록. 남이 나에게 DM 을 시작해도(내 memberships 가 생김) 실시간으로 갱신된다 */
export function useMyDms(): { dms: DmSummary[] | null; error: string | null } {
  const [dms, setDms] = useState<DmSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let latest = 0;
    const load = () => {
      const seq = ++latest;
      void listMyDms().then(
        (list) => {
          if (!alive || seq !== latest) return;
          setDms(list);
          setError(null);
        },
        (e: unknown) => {
          if (alive && seq === latest) setError(e instanceof Error ? e.message : String(e));
        },
      );
    };
    load();
    const unsubscribe = subscribeChannels(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return { dms, error };
}

/** 채널 하나의 미읽음 수. 저장소(unread.ts)가 바뀔 때만 다시 그린다 */
export function useUnread(channelId: string): number {
  return useSyncExternalStore(
    subscribeUnread,
    () => getUnread(channelId),
    () => 0, // 서버에서 그릴 때는 모른다
  );
}
