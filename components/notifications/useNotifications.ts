"use client";

// ③ 내 알림: 목록·안 읽은 수·실시간 받기·띄우기 규칙 (TECH_SPEC 7절 "알림 — 띄우기").
// 알림은 DB 트리거가 만든다 (supabase/migrations/20260929130000_message_notifications.sql). 여기서는 받아서 보여 주기만 한다.
//
// 새 알림이 오면:
//   그 대화를 보고 있고 탭이 보인다  → 띄우지 않고 바로 읽음
//   탭이 보인다                      → 토스트
//   탭이 안 보이고 브라우저 알림 권한  → 브라우저 알림 (tag = 알림 id 라 탭이 여러 개여도 하나)
//   탭이 안 보이고 권한이 없다        → 탭 제목의 (N) 만
// 안 읽은 수는 언제나 알림 버튼 배지와 탭 제목에 보인다.

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { AppNotification, NotificationType } from "@/lib/types/notification";
import { newClientId } from "@/components/chat/useMessages";

const LIST_SIZE = 50;
const PREVIEW_CHARS = 80;

export const TYPE_LABEL: Record<NotificationType, string> = {
  mention: "멘션",
  thread_reply: "스레드 답글",
  dm: "DM",
  event_invite: "회의 초대",
  event_update: "회의 변경",
  event_cancel: "회의 취소",
  event_reminder: "10분 후 회의",
};

/** 화면에 그릴 알림 한 건 */
export type NotificationView = AppNotification & { title: string; preview: string };

/** 띄울 것: 알림 한 건, 또는 끊긴 동안 쌓인 여러 건을 묶은 것 */
export type Arrival = { kind: "one"; item: NotificationView } | { kind: "many"; count: number };

/** 알림을 누르면 갈 주소. 메시지 알림은 ① 이 ?m= 로 이동·강조하고, 답글이면 스레드를 연다 */
export function notificationHref(n: AppNotification): string {
  if (n.message_id) return `/?m=${n.message_id}`;
  if (n.event_id) return `/calendar?e=${n.event_id}`;
  return "/";
}

// 알림에는 본문이 없다. 미리보기는 메시지·채널·회의를 RLS 로 읽어서 만든다 → 채널에서 빠졌으면 본문을 못 본다
async function describe(list: AppNotification[]): Promise<NotificationView[]> {
  if (list.length === 0) return [];
  const supabase = getSupabase();
  const messageIds = [...new Set(list.map((n) => n.message_id).filter((v): v is number => v !== null))];
  const channelIds = [...new Set(list.map((n) => n.channel_id).filter((v): v is string => v !== null))];
  const eventIds = [...new Set(list.map((n) => n.event_id).filter((v): v is string => v !== null))];

  const [messages, channels, events] = await Promise.all([
    messageIds.length
      ? supabase.from("messages").select("id, body, user_id, author").in("id", messageIds)
      : Promise.resolve({ data: [] as { id: number; body: string; user_id: string | null; author: string | null }[] }),
    channelIds.length
      ? supabase.from("channels").select("id, name, type").in("id", channelIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null; type: string }[] }),
    eventIds.length
      ? supabase.from("events").select("id, title, starts_at, rooms(name)").in("id", eventIds)
      : Promise.resolve({ data: [] as { id: string; title: string; starts_at: string; rooms: unknown }[] }),
  ]);
  const msgById = new Map((messages.data ?? []).map((m) => [m.id, m]));
  const chById = new Map((channels.data ?? []).map((c) => [c.id, c]));
  const evById = new Map((events.data ?? []).map((e) => [e.id, e]));

  const authorIds = [...new Set((messages.data ?? []).map((m) => m.user_id).filter((v): v is string => !!v))];
  const { data: people } = authorIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", authorIds)
    : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((people ?? []).map((p) => [p.id, p.display_name]));

  return list.map((n) => {
    if (n.event_id) {
      const ev = evById.get(n.event_id);
      const when = ev
        ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ev.starts_at))
        : "";
      // 회의에서 빠졌거나 지워진 회의면 RLS 가 주지 않는다
      const room = (ev?.rooms as { name?: string } | null | undefined)?.name;
      const preview = ev ? [when, room].filter(Boolean).join(" · ") : "볼 수 없는 회의입니다";
      return { ...n, title: ev?.title ?? "회의", preview };
    }
    const m = n.message_id ? msgById.get(n.message_id) : undefined;
    const ch = n.channel_id ? chById.get(n.channel_id) : undefined;
    const author = m ? (m.author ?? (m.user_id ? nameById.get(m.user_id) : undefined) ?? "알 수 없음") : "알 수 없음";
    const where = ch?.type === "dm" ? "" : ch?.name ? ` · #${ch.name}` : "";
    const body = m ? m.body.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS) || "(첨부)" : "볼 수 없는 메시지입니다";
    return { ...n, title: `${author}${where}`, preview: body };
  });
}

export function useNotifications({
  selfId,
  currentChannelId,
  onArrive,
}: {
  selfId: string | null;
  /** 지금 보고 있는 대화. 그 대화의 알림은 띄우지 않고 바로 읽음 처리한다 */
  currentChannelId: string;
  /** 토스트·브라우저 알림을 띄울 때 부른다 (띄우기 규칙은 여기서 정한다) */
  onArrive: (arrival: Arrival) => void;
}) {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unread, setUnread] = useState(0);
  const lastIdRef = useRef(0);
  const channelRef = useRef(currentChannelId);
  channelRef.current = currentChannelId;
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;

  const refreshUnread = useCallback(async () => {
    if (!selfId) return;
    const { count } = await getSupabase()
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", selfId)
      .is("read_at", null);
    setUnread(count ?? 0);
  }, [selfId]);

  const markRead = useCallback(
    (ids: number[]) => {
      if (!selfId || ids.length === 0) return;
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => (ids.includes(n.id) && !n.read_at ? { ...n, read_at: now } : n)));
      // supabase-js 요청은 then 을 불러야 실제로 나간다
      void getSupabase()
        .from("notifications")
        .update({ read_at: now })
        .in("id", ids)
        .is("read_at", null)
        .then(() => void refreshUnread());
    },
    [selfId, refreshUnread],
  );

  const markAllRead = useCallback(() => {
    if (!selfId) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnread(0);
    void getSupabase()
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", selfId)
      .is("read_at", null)
      .then(() => void refreshUnread());
  }, [selfId, refreshUnread]);

  // 새로 온 알림 처리: 목록에 넣고, 띄우기 규칙에 따라 띄우거나 바로 읽음
  const receive = useCallback(
    async (fresh: AppNotification[], batched: boolean) => {
      const views = await describe(fresh);
      if (views.length === 0) return;
      lastIdRef.current = Math.max(lastIdRef.current, ...views.map((v) => v.id));
      setItems((prev) => {
        const known = new Set(prev.map((n) => n.id));
        return [...views.filter((v) => !known.has(v.id)), ...prev].sort((a, b) => b.id - a.id).slice(0, LIST_SIZE);
      });
      const visible = document.visibilityState === "visible";
      const watching = views.filter((v) => visible && v.channel_id === channelRef.current && v.read_at === null);
      if (watching.length) markRead(watching.map((v) => v.id));
      const rest = views.filter((v) => !watching.includes(v) && v.read_at === null);
      if (rest.length === 0) return void refreshUnread();
      // 끊긴 동안 쌓인 것은 하나씩 띄우지 않고 "알림 N개" 하나로 묶는다
      if (batched && rest.length > 1) arriveRef.current({ kind: "many", count: rest.length });
      else rest.forEach((item) => arriveRef.current({ kind: "one", item }));
      void refreshUnread();
    },
    [markRead, refreshUnread],
  );

  useEffect(() => {
    if (!selfId) return;
    const supabase = getSupabase();
    let alive = true;
    let first = true;
    setItems([]);
    lastIdRef.current = 0;

    async function loadList() {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", selfId)
        .order("id", { ascending: false })
        .limit(LIST_SIZE);
      if (!alive || !data) return;
      const views = await describe(data as AppNotification[]);
      if (!alive) return;
      setItems(views);
      lastIdRef.current = views[0]?.id ?? 0;
      void refreshUnread();
    }

    // 다시 연결되면 마지막으로 받은 알림 id 이후만 받아 온다 (TECH_SPEC 6절 "재접속")
    async function catchUp() {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", selfId)
        .gt("id", lastIdRef.current)
        .order("id")
        .limit(LIST_SIZE);
      if (alive && data?.length) await receive(data as AppNotification[], true);
    }

    // 구독 이름에 고유한 꼬리를 붙인다 (같은 이름이면 이미 구독한 채널이 돌아와 .on() 이 오류를 낸다, TECH_SPEC 13절)
    const channel = supabase
      .channel(`notifications:${selfId}:${newClientId()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${selfId}` },
        (payload) => void receive([payload.new as AppNotification], false),
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (first) {
          first = false;
          void loadList();
        } else {
          void catchUp();
        }
      });

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [selfId, receive, refreshUnread]);

  return { items, unread, markRead, markAllRead };
}
