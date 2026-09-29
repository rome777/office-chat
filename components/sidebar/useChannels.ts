"use client";

// ② 내가 가입한 채널 목록. 채널을 만들거나 가입하면 쓰는 곳 모두 함께 갱신된다.

import { useEffect, useState } from "react";
import type { ChannelSummary } from "@/lib/types/channel";
import { listMyChannels, subscribeChannels } from "./channelSource";

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
