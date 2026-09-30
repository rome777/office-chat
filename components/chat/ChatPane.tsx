"use client";

// ① 가운데 칸 = 메시지 목록 + 입력창

import { Suspense, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { getSupabase } from "@/lib/supabase";
import { useMessages } from "./useMessages";
import { useReadStatus } from "./useReadStatus";
import { useChannelMembers } from "./useChannelMembers";
import { useSelf } from "./useSelf";
import { focusReply } from "./threadFocus";
import { useReactions } from "./useReactions";
import { togglePin, usePins } from "./pins";
import MessageList, { type Focus } from "./MessageList";
import Composer from "./Composer";
import JumpToMessage from "./JumpToMessage";
import s from "./chat.module.css";

const NOTICE_MS = 4000;
const MISSING = "메시지를 찾을 수 없습니다. 지워졌거나 볼 수 없는 메시지입니다.";

type Jump = { id: number; channelId: string; parentId: number | null };

export default function ChatPane() {
  const { me, channel, setChannel, setConnection, openPanel } = useWorkspace();
  const self = useSelf();
  const {
    messages,
    pending,
    conn,
    online,
    fatal,
    names,
    attachments,
    readyFor,
    hasOlder,
    loadingOlder,
    send,
    discard,
    loadOlder,
    reveal,
  } = useMessages(channel.id, me.name);
  const members = useChannelMembers(channel.id);
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const handles = useMemo(() => new Set(members.map((m) => m.handle.toLowerCase())), [members]);
  const { markRead, unreadCount } = useReadStatus(channel.id, self?.id ?? null, memberIds);
  const { reactions, toggle: toggleReaction } = useReactions(channel.id, messages[0]?.id ?? null);
  const pins = usePins(channel.id);
  const pinned = useMemo(() => new Set(pins.map((p) => p.message_id)), [pins]);
  const [sendTick, setSendTick] = useState(0);
  // 주소로 받은 이동 요청. 그 채널의 처음 불러오기가 끝난 뒤에 처리한다.
  // 답글이면 부모 메시지로 이동하고 스레드를 연다
  const [jump, setJump] = useState<Jump | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [jumpNotice, setJumpNotice] = useState<string | null>(null);
  // DM 은 채널 이름 대신 상대 이름을 "@이름" 으로 (채널 목록(②)이 name 에 상대 이름을 넣는다)
  const where = channel.type === "dm" ? `@${channel.name}` : `#${channel.name}`;

  // 헤더의 연결 상태 표시(①)가 화면 상태에서 읽는다
  useEffect(() => {
    setConnection({ state: conn, online });
  }, [conn, online, setConnection]);

  // 1) 주소의 메시지가 어느 채널의 무엇인지 알아낸다 (볼 수 없으면 RLS 가 0건을 준다)
  async function requestJump(messageId: number) {
    const supabase = getSupabase();
    const { data: m } = await supabase
      .from("messages")
      .select("id, channel_id, parent_id")
      .eq("id", messageId)
      .maybeSingle();
    if (!m) return setJumpNotice(MISSING);
    if (m.channel_id !== channel.id) {
      // 다른 채널의 메시지면 그 채널로 바꾼다 (채널 목록은 ② 가 그리고, 바꾸는 것은 화면 상태로 한다)
      const { data: ch } = await supabase.from("channels").select("id, name, type").eq("id", m.channel_id).maybeSingle();
      if (!ch) return setJumpNotice(MISSING);
      let name: string = ch.name ?? "DM";
      if (ch.type === "dm") {
        // DM 은 이름이 없다 → 상대 이름으로 (채널 목록(②)과 같게)
        const { data: others } = await supabase
          .from("memberships")
          .select("user_id, profiles(display_name)")
          .eq("channel_id", ch.id)
          .neq("user_id", self?.id ?? "");
        name = (others?.[0]?.profiles as { display_name?: string } | null)?.display_name ?? "DM";
      }
      setChannel({ id: ch.id, name, type: ch.type });
    }
    setJump({ id: m.id, channelId: m.channel_id, parentId: m.parent_id });
  }

  // 2) 그 채널을 다 불러왔으면 이동한다
  useEffect(() => {
    if (!jump || readyFor !== jump.channelId || channel.id !== jump.channelId) return;
    const target = jump.parentId ?? jump.id;
    const replyId = jump.parentId !== null ? jump.id : null;
    setJump(null);
    void reveal(target).then((ok) => {
      if (!ok) return setJumpNotice("메시지를 불러오지 못했습니다. 연결을 확인해 주세요.");
      setFocus((f) => ({ id: target, seq: (f?.seq ?? 0) + 1 }));
      if (replyId !== null) {
        focusReply(replyId);
        openPanel({ kind: "thread", messageId: target });
      }
    });
  }, [jump, readyFor, channel.id, reveal, openPanel]);

  useEffect(() => {
    if (!jumpNotice) return;
    const timer = setTimeout(() => setJumpNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [jumpNotice]);

  // 리액션·고정은 DB 가 멤버인지 확인한다. 실패하면(마이그레이션 전, 권한) 위쪽 알림 줄에 잠깐 보인다
  const react = (id: number, emoji: string) =>
    void toggleReaction(id, emoji).catch((e: unknown) => setJumpNotice(`리액션을 달지 못했습니다: ${e instanceof Error ? e.message : String(e)}`));
  const pin = (id: number) =>
    void togglePin(channel.id, id).catch((e: unknown) => setJumpNotice(`고정하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`));

  function sendNow(body: string, clientId?: string, file?: File) {
    setSendTick((t) => t + 1);
    void send(body, clientId, file);
  }

  if (fatal) {
    return (
      <section className={s.pane}>
        <p className={`${s.notice} error-text`}>{fatal}</p>
      </section>
    );
  }

  return (
    <section className={s.pane}>
      <Suspense fallback={null}>
        <JumpToMessage onJump={(id) => void requestJump(id)} />
      </Suspense>
      {jumpNotice && <p className={`${s.notice} error-text`}>{jumpNotice}</p>}
      <MessageList
        messages={messages}
        pending={pending}
        self={self}
        names={names}
        attachments={attachments}
        sendTick={sendTick}
        hasOlder={hasOlder}
        loadingOlder={loadingOlder}
        focus={focus}
        onLoadOlder={() => void loadOlder()}
        onRead={markRead}
        unreadCount={unreadCount}
        handles={handles}
        onOpenThread={(id) => openPanel({ kind: "thread", messageId: id })}
        onFocusMissing={() => setJumpNotice(MISSING)}
        onRetry={(p) => sendNow(p.body, p.clientId, p.file)}
        onDiscard={discard}
        reactions={reactions}
        pinned={pinned}
        onReact={react}
        onPin={pin}
      />
      <Composer
        placeholder={`${where} 에 메시지 입력…`}
        members={members}
        selfId={self?.id ?? null}
        onSend={(body, file) => sendNow(body, undefined, file)}
      />
    </section>
  );
}
