"use client";

// ③ 내 알림: 목록·안 읽은 수·실시간 받기·띄우기 규칙 (TECH_SPEC 7절 "알림 — 띄우기").
// 알림은 DB 트리거가 만든다 (supabase/migrations/20260929130000_message_notifications.sql). 여기서는 받아서 보여 주기만 한다.
//
// 새 알림이 오면:
//   그 메시지를 보고 있다 (탭이 보이고 창에 포커스,
//     최상위 메시지면 그 채널 · 답글이면 그 스레드가 열려 있다) → 띄우지 않고 바로 읽음
//   탭을 보고 있다                                → 토스트
//   안 보고 있고 브라우저 알림 권한                → 브라우저 알림 (tag = 알림 id 라 탭이 여러 개여도 하나)
//   안 보고 있고 권한이 없다                      → 탭이 보이면 토스트, 아니면 탭 제목의 (N) 만
// 안 읽은 수는 언제나 알림 버튼 배지와 탭 제목에 보인다.
// 나중에라도 알림의 메시지가 화면에 보이면 읽음이 된다 (아래 "화면에 보이면 읽음").

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { AppNotification, NotificationType } from "@/lib/types/notification";
import { newClientId } from "@/components/chat/useMessages";
import { getMentionLabels } from "@/components/people/directory";
import { showMentions } from "@/lib/mentions";

const LIST_SIZE = 50;
const PREVIEW_CHARS = 80;

export const TYPE_LABEL: Record<NotificationType, string> = {
  mention: "멘션",
  thread_reply: "스레드 답글",
  dm: "DM",
  event_invite: "일정 초대",
  event_update: "일정 변경",
  event_cancel: "일정 취소",
  event_reminder: "곧 시작하는 일정", // 몇 분 전인지는 미리보기 앞에 붙인다 (사람마다 알림 시각이 다르다, 2026-09-30)
  event_decline: "일정 불참",
};

/** 시작 전 알림의 앞말 (예전 알림은 remind_minutes 가 없다 → 10분) */
function reminderLead(m: number | null | undefined): string {
  const v = m ?? 10;
  if (v === 0) return "지금 시작";
  if (v === 1440) return "내일 시작";
  if (v >= 60) return `${v / 60}시간 후 시작`;
  return `${v}분 후 시작`;
}

/** 화면에 그릴 알림 한 건. parentId 는 답글이면 부모 메시지 id */
export type NotificationView = AppNotification & { title: string; preview: string; parentId: number | null };

/** 띄울 것: 알림 한 건, 또는 끊긴 동안 쌓인 여러 건을 묶은 것 */
export type Arrival = { kind: "one"; item: NotificationView } | { kind: "many"; count: number };

/**
 * 사용자가 지금 이 탭을 보고 있는가.
 * 다른 프로그램으로 Alt+Tab 하거나 다른 브라우저 창을 앞에 두면 visibilityState 는 그대로 "visible" 이다
 * → 포커스까지 봐야 한다. visibilityState 만 봤을 때는 브라우저 알림 대신 안 보이는 토스트가 떴다 (2026-09-29)
 */
export function isLooking(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/** 알림을 누르면 갈 주소. 메시지 알림은 ① 이 ?m= 로 이동·강조하고, 답글이면 스레드를 연다 */
export function notificationHref(n: AppNotification): string {
  if (n.message_id) return `/chat?m=${n.message_id}`;
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
      ? supabase.from("messages").select("id, body, user_id, author, parent_id").in("id", messageIds)
      : Promise.resolve({
          data: [] as { id: number; body: string; user_id: string | null; author: string | null; parent_id: number | null }[],
        }),
    channelIds.length
      ? supabase.from("channels").select("id, name, type").in("id", channelIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null; type: string }[] }),
    eventIds.length
      ? supabase.from("events").select("id, title, starts_at, location, rooms(name)").in("id", eventIds)
      : Promise.resolve({ data: [] as { id: string; title: string; starts_at: string; location: string | null; rooms: unknown }[] }),
  ]);
  const msgById = new Map((messages.data ?? []).map((m) => [m.id, m]));
  const chById = new Map((channels.data ?? []).map((c) => [c.id, c]));
  const evById = new Map((events.data ?? []).map((e) => [e.id, e]));

  // 메시지 작성자와, 회의 불참 알림의 불참한 사람
  const authorIds = [
    ...new Set(
      [...(messages.data ?? []).map((m) => m.user_id), ...list.map((n) => n.actor_id)].filter((v): v is string => !!v),
    ),
  ];
  const { data: people } = authorIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", authorIds)
    : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  // 본문의 "@아이디" 는 "@이름" 으로 (토스트·브라우저 알림도 이 미리보기를 쓴다). 명부를 못 받으면 글자 그대로
  const labels = await getMentionLabels().catch(() => new Map<string, string>());

  return list.map((n) => {
    if (n.event_id) {
      const ev = evById.get(n.event_id);
      const when = ev
        ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ev.starts_at))
        : "";
      // 회의에서 빠졌거나 지워진 회의면 RLS 가 주지 않는다
      const room = (ev?.rooms as { name?: string } | null | undefined)?.name ?? ev?.location ?? undefined;
      // 회의 불참은 누가 불참했는지를 앞에 붙인다 ("김OO 님 · 10. 1. 오후 02:00 · 회의실")
      const who = n.type === "event_decline" ? `${(n.actor_id && nameById.get(n.actor_id)) || "알 수 없음"} 님` : "";
      const soon = n.type === "event_reminder" ? reminderLead(n.remind_minutes) : "";
      const preview = ev ? [soon, who, when, room].filter(Boolean).join(" · ") : "볼 수 없는 일정입니다";
      return { ...n, title: ev?.title ?? "일정", preview, parentId: null };
    }
    const m = n.message_id ? msgById.get(n.message_id) : undefined;
    const ch = n.channel_id ? chById.get(n.channel_id) : undefined;
    const author = m ? (m.author ?? (m.user_id ? nameById.get(m.user_id) : undefined) ?? "알 수 없음") : "알 수 없음";
    const where = ch?.type === "dm" ? "" : ch?.name ? ` · #${ch.name}` : "";
    const body = m ? showMentions(m.body, labels).replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS) || "(첨부)" : "볼 수 없는 메시지입니다";
    return { ...n, title: `${author}${where}`, preview: body, parentId: m?.parent_id ?? null };
  });
}

export function useNotifications({
  selfId,
  currentChannelId,
  openThreadId,
  onArrive,
}: {
  selfId: string | null;
  /** 지금 보고 있는 대화. 그 대화의 최상위 메시지 알림은 띄우지 않고 바로 읽음 처리한다 */
  currentChannelId: string;
  /** 열려 있는 스레드의 부모 메시지 id. 그 스레드의 답글 알림은 띄우지 않고 바로 읽음 처리한다 */
  openThreadId: number | null;
  /** 토스트·브라우저 알림을 띄울 때 부른다 (띄우기 규칙은 여기서 정한다) */
  onArrive: (arrival: Arrival) => void;
}) {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unread, setUnread] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const lastIdRef = useRef(0);
  const channelRef = useRef(currentChannelId);
  channelRef.current = currentChannelId;
  const threadRef = useRef(openThreadId);
  threadRef.current = openThreadId;
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
      // 답글은 채널만 같아서는 안 보인다 (채널 본문에는 답글이 없다) → 그 스레드가 열려 있어야 보고 있는 것이다
      const looking = isLooking();
      const inView = (v: NotificationView) =>
        v.parentId === null ? v.channel_id === channelRef.current : v.parentId === threadRef.current;
      const watching = views.filter((v) => looking && v.message_id !== null && inView(v) && v.read_at === null);
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
      // 지워진 알림을 목록에서 뺀다 (다시 참석해서 안 읽은 불참 알림이 지워질 때, 10분 전 알림을 다시 보낼 때).
      // DELETE 는 필터를 걸 수 없어 모두 받는다 — 기본 키(id)만 오고, 내 목록에 있는 것만 뺀다
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "notifications" }, (payload) => {
        const id = (payload.old as { id?: number }).id;
        if (id === undefined || !itemsRef.current.some((n) => n.id === id)) return;
        setItems((prev) => prev.filter((n) => n.id !== id));
        void refreshUnread();
      })
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

  // 안 읽은 알림의 메시지가 화면에 보이면 읽음 (채널 본문이든 스레드 패널이든, 나중에 열어서 봐도).
  // 메시지는 ① 의 MessageItem 이 [data-message-id] 로 그린다 — 그 속성이 ① 과 ③ 사이의 약속이다.
  // 조금이라도 보이면 본 것으로 친다 (① 의 읽음 위치와 같은 기준). 탭을 안 보고 있으면 다시 볼 때 친다
  useEffect(() => {
    const byMessage = new Map<number, number[]>();
    for (const n of items) {
      if (n.read_at || n.message_id === null) continue;
      byMessage.set(n.message_id, [...(byMessage.get(n.message_id) ?? []), n.id]);
    }
    if (byMessage.size === 0) return;

    const onScreen = new Set<number>();
    const done = new Set<number>();
    const flush = () => {
      if (!isLooking()) return;
      const ids = [...onScreen].flatMap((m) => byMessage.get(m) ?? []).filter((id) => !done.has(id));
      if (ids.length === 0) return;
      ids.forEach((id) => done.add(id));
      markRead(ids);
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = Number((e.target as HTMLElement).dataset.messageId);
        if (e.isIntersecting) onScreen.add(id);
        else onScreen.delete(id);
      }
      flush();
    });
    // 메시지는 나중에 그려진다 (채널을 바꾸거나 스레드를 열거나 이전 메시지를 불러올 때) → 바뀔 때마다 다시 찾는다
    const watched = new WeakSet<Element>();
    const scan = () => {
      for (const id of byMessage.keys()) {
        document.querySelectorAll(`[data-message-id="${id}"]`).forEach((el) => {
          if (watched.has(el)) return;
          watched.add(el);
          io.observe(el);
        });
      }
    };
    let frame = 0;
    const mo = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scan();
      });
    });
    scan();
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("focus", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      io.disconnect();
      window.removeEventListener("focus", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [items, markRead]);

  return { items, unread, markRead, markAllRead };
}
