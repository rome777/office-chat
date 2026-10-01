"use client";

// 채팅 화면 (/chat): 메시지 목록 칸 | 채팅 머리 + 대화(①). 오른쪽 패널은 공통 틀(AppShell)이 그린다.
// ?c=<채널 id> 로 들어오면 그 대화를 연다 (대시보드·프로필 카드가 이 주소로 보낸다).

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ChatPane from "@/components/chat/ChatPane"; // ①
import { getSupabase } from "@/lib/supabase";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import ChatHeader from "./ChatHeader";
import MessageNav from "./MessageNav";
import s from "./chat.module.css";

export default function ChatWorkspace() {
  return (
    <div className={s.workspace}>
      <MessageNav />
      <section className={s.chatColumn}>
        <Suspense fallback={null}>
          <ChannelFromUrl />
        </Suspense>
        <ChatHeader />
        <ChatPane />
      </section>
    </div>
  );
}

/** ?c= 를 읽어 그 대화로 바꾸고 주소에서 지운다. 볼 수 없는 채널이면(RLS 0행) 그대로 둔다.
 *  주소는 채널을 다 읽고 연 **뒤에** 지운다 — 먼저 지우면 c 가 바뀌어 이 effect 가 정리되면서(alive=false) 읽은 결과를 버리고,
 *  목록 칸이 기본값(즐겨찾기 채널)을 열어 버린다 (2026-10-01, 일정의 [참석자와 대화]에서 발견) */
function ChannelFromUrl() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { setChannel } = useWorkspace();
  const c = params.get("c");

  useEffect(() => {
    if (!c) return;
    const clearUrl = () => {
      const rest = new URLSearchParams(params.toString());
      rest.delete("c");
      const qs = rest.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    };

    let alive = true;
    const supabase = getSupabase();
    void (async () => {
      const { data: ch } = await supabase.from("channels").select("id, name, type").eq("id", c).maybeSingle();
      if (!alive) return;
      if (!ch) return clearUrl();
      let name: string = ch.name ?? "DM";
      if (ch.type === "dm") {
        const { data: session } = await supabase.auth.getSession();
        const { data: others } = await supabase
          .from("memberships")
          .select("user_id, profiles(display_name)")
          .eq("channel_id", ch.id)
          .neq("user_id", session.session?.user.id ?? "");
        name = (others?.[0]?.profiles as { display_name?: string } | null)?.display_name ?? "DM";
      }
      if (!alive) return;
      setChannel({ id: ch.id, name, type: ch.type });
      clearUrl();
    })();
    return () => {
      alive = false;
    };
    // 주소의 c 가 바뀔 때만 한 번 처리한다
  }, [c]);

  return null;
}
