"use client";

// 프로필 카드를 여는 곳(메시지 작성자, 채널 멤버, 조직도, DM 목록)과 그리는 곳(AppShell 의 ProfileCardHost)을 잇는다.

import { useSyncExternalStore } from "react";

let open: string | null = null;
const listeners = new Set<() => void>();

export function openProfileCard(userId: string) {
  open = userId;
  listeners.forEach((fn) => fn());
}

export function closeProfileCard() {
  open = null;
  listeners.forEach((fn) => fn());
}

export function useOpenProfileCard(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => open,
    () => null,
  );
}
