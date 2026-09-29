"use client";

// 공통 틀 — 입장 관문(②)을 지나면 화면 상태와 세 칸 배치를 연다. 이 파일은 고치지 않는다.

import AuthGate from "@/components/auth/AuthGate";
import Workspace from "@/components/workspace/Workspace";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceContext";

export default function Home() {
  return (
    <AuthGate>
      {(me, signOut) => (
        <WorkspaceProvider me={me} signOut={signOut}>
          <Workspace />
        </WorkspaceProvider>
      )}
    </AuthGate>
  );
}
