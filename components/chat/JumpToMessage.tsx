"use client";

// ① 메시지로 이동. 주소에 `?m=<메시지 id>` 가 붙으면 그 메시지로 간다 (알림 ③·검색 ② 가 이 주소로 보낸다).
// 처리한 뒤에는 `m` 을 주소에서 지운다. 그래야 같은 알림을 다시 눌렀을 때도 이동한다.
// useSearchParams 는 Suspense 안에서만 쓸 수 있어서 따로 뗐다 (ChatPane 이 Suspense 로 감싼다).

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function JumpToMessage({ onJump }: { onJump: (messageId: number) => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const m = params.get("m");

  useEffect(() => {
    if (m === null) return;
    const rest = new URLSearchParams(params.toString());
    rest.delete("m");
    const qs = rest.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });

    const id = Number(m);
    if (Number.isSafeInteger(id) && id > 0) onJump(id);
    // 주소의 m 이 바뀔 때만 한 번 처리한다
  }, [m]);

  return null;
}
