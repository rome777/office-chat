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
