"use client";

// 대시보드 데이터. 새 표는 없다 — 캘린더·할 일·메시지를 RLS 그대로 읽는다 (내가 볼 수 있는 것만 온다).

import { getSupabase } from "@/lib/supabase";
import { listTeamEvents } from "@/components/calendar/source";
import { getPeople } from "@/components/people/directory";
import { GENERAL_ID } from "@/components/sidebar/channelSource";
import type { ChannelSummary, DmSummary } from "@/lib/types/channel";

export type MyTodo = {
  id: string;
  task: string;
  due: string | null;
  channel_id: string;
  channel_name: string;
  evidence_message_id: number | null;
};

/** 내가 담당인 안 끝난 할 일. 기한이 지난 것·오늘 것부터, 기한 없는 것은 뒤로 */
export async function listMyTodos(me: string): Promise<MyTodo[]> {
  const { data, error } = await getSupabase()
    .from("todos")
    .select("id, task, due, channel_id, evidence_message_id, channels(name, type)")
    .eq("assignee", me)
    .is("done_at", null)
    .order("due", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => {
    const ch = t.channels as unknown as { name: string | null; type: string } | null;
    return {
      id: t.id as string,
      task: t.task as string,
      due: t.due as string | null,
      channel_id: t.channel_id as string,
      channel_name: ch?.type === "dm" ? "DM" : `#${ch?.name ?? "알 수 없음"}`,
      evidence_message_id: t.evidence_message_id as number | null,
    };
  });
}

/** 끝냄 표시. 채널 멤버는 done_at 만 고칠 수 있다 (RLS) */
export async function finishTodo(id: string) {
  const { data, error } = await getSupabase().from("todos").update({ done_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error || !data?.length) throw new Error(error?.message ?? "끝냄으로 바꾸지 못했습니다");
}

export type PendingInvite = { id: string; title: string; starts_at: string; all_day: boolean };

/** 내가 아직 답하지 않은 앞으로의 일정 초대 (내가 만든 일정은 뺀다). 가까운 것부터 (2026-10-01 WU-47) */
export async function listPendingInvites(me: string): Promise<PendingInvite[]> {
  const { data, error } = await getSupabase()
    .from("event_attendees")
    .select("events!inner(id, title, starts_at, ends_at, all_day, created_by, canceled_at)")
    .eq("user_id", me)
    .eq("response", "pending")
    .is("events.canceled_at", null)
    .gt("events.ends_at", new Date().toISOString())
    .neq("events.created_by", me)
    .limit(200); // 서버는 부모 행을 일정 시각으로 정렬하지 못해 넉넉히 받아 아래에서 정렬한다
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => r.events as unknown as PendingInvite)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map(({ id, title, starts_at, all_day }) => ({ id, title, starts_at, all_day }));
}

export type TeamAway = {
  id: string;
  userId: string;
  name: string;
  kind: "leave" | "outside";
  /** list_team_events 가 공개 범위대로 준 말: "연차"·"반차"·"휴가"·"부재"·"기타 부재"·"외근" */
  label: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** 외근을 팀에 공개했을 때만 */
  title: string | null;
  location: string | null;
};

/** 같은 부서 팀원의 휴가·부재와 외근 (2026-10-01 WU-49). 가리는 것은 list_team_events 가 한다 — 새 표·함수 없음 */
export async function listTeamAway(from: Date, to: Date): Promise<TeamAway[]> {
  const list = (await listTeamEvents(from, to)).filter(
    (t): t is typeof t & { kind: "leave" | "outside" } => t.kind === "leave" || t.kind === "outside",
  );
  const people = list.length ? await getPeople(list.map((t) => t.user_id)) : [];
  const nameOf = new Map(people.map((p) => [p.id, p.display_name]));
  return list.map((t) => ({
    id: t.event_id,
    userId: t.user_id,
    name: nameOf.get(t.user_id) ?? "알 수 없는 사람", // getPeople 이 모르는 id 도 돌려주므로 실제로는 오지 않는다
    kind: t.kind,
    label: t.label,
    startsAt: t.starts_at,
    endsAt: t.ends_at,
    allDay: t.all_day,
    title: t.title,
    location: t.location,
  }));
}

export type Notice = {
  id: number;
  /** 첫 줄 (멘션 글자는 화면에서 이름으로 바꾼다) */
  title: string;
  author: string | null;
  at: string;
  replies: number;
  pinned: boolean;
  unread: boolean;
};

export type NoticeBoard = { channelId: string; channelName: string; notices: Notice[] };

const NOTICE_PINNED = 2; // 고정 공지는 최근에 고정한 것부터 이만큼만 위에

/** 회사 공지 (2026-10-01 WU-50): 내가 멤버인 공지 채널(`notice_unit_id` 가 있는 채널, 모든 사람이 멤버)의 최상위 메시지.
 *  고정 공지(최근 고정 순, 최대 2건)를 위에, 나머지는 최근 순으로 채워 limit 건. 내 읽음 위치보다 뒤이고 남이 쓴 것이면 안 읽음
 *  (안 읽은 수 배지와 같은 규칙). 답글 수는 채팅과 같은 `messages.reply_count`.
 *  공지 채널이 없거나 `notice_unit_id` 칸이 없는 예전 DB 면 null, 그 밖의 오류는 던진다 (화면이 받아 둔 것을 지키게) */
export async function listNotices(me: string, limit: number): Promise<NoticeBoard | null> {
  const supabase = getSupabase();
  const { data: ch, error: chError } = await supabase
    .from("channels")
    .select("id, name, memberships!inner(user_id)")
    .not("notice_unit_id", "is", null)
    .eq("memberships.user_id", me)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (chError) {
    if (chError.code === "42703") return null; // 칸 없음 (공지 채널 마이그레이션 전)
    throw new Error(chError.message);
  }
  if (!ch) return null;
  const channelId = ch.id as string;
  const COLS = "id, user_id, body, created_at, reply_count";
  const [recent, pins, read] = await Promise.all([
    supabase
      .from("messages")
      .select(COLS)
      .eq("channel_id", channelId)
      .is("parent_id", null)
      .is("deleted_at", null)
      .order("id", { ascending: false })
      .limit(limit),
    supabase
      .from("pinned_messages")
      .select(`message_id, messages!inner(${COLS}, parent_id, deleted_at)`)
      .eq("channel_id", channelId)
      .is("messages.parent_id", null)
      .is("messages.deleted_at", null)
      .order("pinned_at", { ascending: false })
      .limit(NOTICE_PINNED),
    supabase.from("read_positions").select("last_read_message_id").eq("channel_id", channelId).eq("user_id", me).maybeSingle(),
  ]);
  if (recent.error) throw new Error(recent.error.message);
  if (pins.error) throw new Error(pins.error.message);
  type Row = { id: number; user_id: string | null; body: string; created_at: string; reply_count: number };
  const pinned = (pins.data ?? []).map((p) => p.messages as unknown as Row);
  const pinnedIds = new Set(pinned.map((m) => m.id));
  const rows = [...pinned, ...((recent.data ?? []) as Row[]).filter((m) => !pinnedIds.has(m.id))].slice(0, limit);
  const authorIds = [...new Set(rows.map((m) => m.user_id).filter((v): v is string => !!v))];
  const people = authorIds.length ? await getPeople(authorIds) : [];
  const nameOf = new Map(people.map((p) => [p.id, p.display_name]));
  // 읽음 위치를 못 받으면 안 읽음 표시를 끈다 (0 으로 보면 남의 공지가 모두 "N")
  const lastRead = read.error ? Infinity : Number(read.data?.last_read_message_id ?? 0);
  return {
    channelId,
    channelName: ch.name as string,
    notices: rows.map((m) => ({
      id: m.id,
      title: m.body.split("\n").find((l) => l.trim())?.trim() ?? "(첨부)",
      author: m.user_id ? (nameOf.get(m.user_id) ?? null) : null,
      at: m.created_at,
      replies: m.reply_count ?? 0,
      pinned: pinnedIds.has(m.id),
      unread: m.id > lastRead && m.user_id !== me,
    })),
  };
}

export type Recent = {
  id: string;
  kind: "channel" | "dm";
  name: string;
  otherId: string | null;
  author: string | null;
  body: string;
  at: string;
};

/** 대화마다 가장 최근의 최상위 메시지 하나씩 (대화 수만큼 묻는다 — 사내 규모라 많지 않다). 최근 것부터 limit 개 */
export async function listRecent(channels: ChannelSummary[], dms: DmSummary[], limit: number): Promise<Recent[]> {
  const supabase = getSupabase();
  const targets = [
    ...channels.filter((c) => c.id !== GENERAL_ID).map((c) => ({ id: c.id, kind: "channel" as const, name: c.name, otherId: null })),
    ...dms.map((d) => ({ id: d.id, kind: "dm" as const, name: d.other.display_name, otherId: d.other.id })),
  ];
  const rows = await Promise.all(
    targets.map((t) =>
      supabase
        .from("messages")
        .select("user_id, body, created_at")
        .eq("channel_id", t.id)
        .is("parent_id", null)
        .is("deleted_at", null)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  );
  const found = targets
    .map((t, i) => ({ t, m: rows[i].data as { user_id: string | null; body: string; created_at: string } | null }))
    .filter((x): x is { t: (typeof targets)[number]; m: NonNullable<typeof x.m> } => !!x.m)
    .sort((a, b) => b.m.created_at.localeCompare(a.m.created_at))
    .slice(0, limit);
  const ids = [...new Set(found.map((x) => x.m.user_id).filter((v): v is string => !!v))];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, display_name").in("id", ids)
    : { data: [] as { id: string; display_name: string }[] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  return found.map(({ t, m }) => ({
    ...t,
    author: m.user_id ? (nameOf.get(m.user_id) ?? null) : null,
    body: m.body,
    at: m.created_at,
  }));
}
