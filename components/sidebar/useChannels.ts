"use client";

// ② 내가 가입한 채널 목록. 채널을 만들거나 가입하면 쓰는 곳 모두 함께 갱신된다.

import { useEffect, useState } from "react";
import type { ChannelSummary } from "@/lib/types/channel";
import { listMyChannels, subscribeChannels } from "./channelSource";

export function useMyChannels(): ChannelSummary[] | null {
  const [channels, setChannels] = useState<ChannelSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void listMyChannels().then((list) => {
        if (alive) setChannels(list);
      });
    load();
    const unsubscribe = subscribeChannels(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return channels;
}
