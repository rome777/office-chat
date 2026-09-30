"use client";

// ③ 알림 버튼(NotificationBell)이 가진 안 읽은 수와 "목록 열기"를 다른 곳(왼쪽 메뉴의 알림, 대시보드 카드)에 나눈다.
// 알림 구독은 알림 버튼 하나만 연다 — 두 번 열면 토스트가 두 번 뜬다.

import { useSyncExternalStore } from "react";

let unread = 0;
const listeners = new Set<() => void>();
const openers = new Set<() => void>();

export function publishUnread(n: number) {
  if (n === unread) return;
  unread = n;
  listeners.forEach((fn) => fn());
}

export function useBellUnread(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => unread,
    () => 0,
  );
}

/** 알림 버튼이 목록을 여는 함수를 등록한다 */
export function onOpenRequest(fn: () => void): () => void {
  openers.add(fn);
  return () => void openers.delete(fn);
}

export function openNotifications() {
  openers.forEach((fn) => fn());
}
