"use client";

// 공통 틀 (2026-09-30 개편, WU-35) — 로그인한 화면(대시보드·채팅·캘린더) 모두가 이 틀 안에 뜬다.
// 입장 관문(②) → 화면 상태(WorkspaceContext) → 메뉴·상단 바·오른쪽 패널. 페이지를 옮겨 다녀도 상태와 알림 구독이 이어진다.

import type { ReactNode } from "react";
import AuthGate from "@/components/auth/AuthGate";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceContext";
import AppShell from "./AppShell";

export default function AppFrame({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      {(me, signOut) => (
        <WorkspaceProvider me={me} signOut={signOut}>
          <AppShell>{children}</AppShell>
        </WorkspaceProvider>
      )}
    </AuthGate>
  );
}
