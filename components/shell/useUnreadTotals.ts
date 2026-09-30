"use client";

// 안 읽은 메시지 합계 (왼쪽 메뉴의 "메시지" 배지, 대시보드 카드). 채널별 숫자는 ② 의 미읽음 저장소(unread.ts)를 그대로 읽는다.
// 목록에서 숨긴 #일반 은 셀 수 없으므로(열 곳이 없다) 합계에서 뺀다.

import { useMemo, useSyncExternalStore } from "react";
import { GENERAL_ID } from "@/components/sidebar/channelSource";
import { getUnread, subscribeUnread } from "@/components/sidebar/unread";
import { useMyChannels, useMyDms } from "@/components/sidebar/useChannels";

export function useUnreadTotals(): { channels: number; dms: number; total: number } {
  const { channels } = useMyChannels();
  const { dms } = useMyDms();
  const channelIds = useMemo(() => (channels ?? []).map((c) => c.id).filter((id) => id !== GENERAL_ID).join(","), [channels]);
  const dmIds = useMemo(() => (dms ?? []).map((d) => d.id).join(","), [dms]);
  const sum = (ids: string) => (ids ? ids.split(",").reduce((n, id) => n + getUnread(id), 0) : 0);
  const ch = useSyncExternalStore(subscribeUnread, () => sum(channelIds), () => 0);
  const dm = useSyncExternalStore(subscribeUnread, () => sum(dmIds), () => 0);
  return { channels: ch, dms: dm, total: ch + dm };
}
