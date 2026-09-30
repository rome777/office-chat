// ② 회사 전체 접속자 채널 — 남의 상태 점(온라인·자리 비움·방해 금지·오프라인)을 여기서 받는다.
// DB 의 status 는 남이 읽을 수 없다 (20260930150000_status_privacy). 접속 중인 사람만 이 채널에 자기 상태를 실어 보내고,
// "오프라인으로 표시"(invisible)면 들어가지 않는다 → 남에게는 접속을 끊은 사람과 똑같이 보인다.
// 채널 하나를 탭 전체가 나눠 쓴다. 들어가는 키는 내 id 라서, 같은 사람이 탭을 여러 개 열어도 한 사람이다 (가장 최근에 보낸 상태를 쓴다).
// 한계: 키와 at 을 보내는 쪽이 정하는 공개 채널이라, 로그인한 사람이 남의 id 로 들어가 그 사람의 점을 바꿀 수 있다 (TECH_SPEC 4절).
// 서버가 확인하려면 private 채널 + realtime.messages RLS 가 필요하다. 화면 표시일 뿐 권한과는 관계없다.

import { useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { DisplayStatus, Status } from "@/lib/types/profile";
import { getSupabase } from "@/lib/supabase";

// 접속자 수처럼 모두가 같은 이름으로 들어가야 하는 구독이라 이름에 꼬리를 붙이지 않는다 (TECH_SPEC 13절)
const CHANNEL = "presence:company";

type Meta = { status: Status; at: number };

let channel: RealtimeChannel | null = null;
let starting = false;
let joined = false;
let mine: Status | null = null; // 내가 보낼 상태. null 이면 아직 모름
let statuses: ReadonlyMap<string, DisplayStatus> = new Map();
const listeners = new Set<() => void>();

let channelUser: string | null = null; // 이 채널에 들어간 키(내 id)
let watching = false;

// 채널을 버린다. 다음 ensure() 가 새로 만든다
function drop() {
  const ch = channel;
  channel = null;
  channelUser = null;
  joined = false;
  if (ch) void getSupabase().removeChannel(ch);
}

// 다른 탭에서 다른 계정으로 로그인하면 이 탭의 세션도 바뀐다 → 옛 사람 키로 남아 있지 않게 새로 들어간다
function watchAuth() {
  if (watching) return;
  watching = true;
  getSupabase().auth.onAuthStateChange((_event, session) => {
    const id = session?.user.id ?? null;
    if (channel && channelUser !== id) {
      drop();
      mine = null; // 새 사람의 상태는 헤더가 다시 알려 준다
      if (id) setTimeout(() => void ensure(), 0); // 콜백 안에서 곧바로 supabase 를 부르면 멈출 수 있다
    }
  });
}

async function ensure() {
  watchAuth();
  if (channel || starting) return;
  starting = true;
  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id;
    if (!id) return;
    const ch = supabase.channel(CHANNEL, { config: { presence: { key: id } } });
    channelUser = id;
    ch.on("presence", { event: "sync" }, () => {
      const next = new Map<string, DisplayStatus>();
      for (const [key, metas] of Object.entries(ch.presenceState<Meta>())) {
        const latest = metas.reduce((a, b) => ((b.at ?? 0) > (a.at ?? 0) ? b : a));
        if (latest.status === "online" || latest.status === "away" || latest.status === "dnd") next.set(key, latest.status);
      }
      statuses = next;
      listeners.forEach((fn) => fn());
    }).subscribe((s) => {
      // 끊겼다 다시 붙어도 SUBSCRIBED 가 다시 오므로 그때마다 내 상태를 다시 보낸다
      joined = s === "SUBSCRIBED";
      if (joined) void apply();
      // 서버가 채널을 닫으면(로그인 토큰 만료 등) supabase-js 가 다시 붙지 않는다 → 버리고 새로 들어간다
      if (s === "CLOSED" && channel === ch) {
        drop();
        setTimeout(() => void ensure().then(apply), 3000);
      }
    });
    channel = ch;
  } finally {
    starting = false;
  }
}

async function apply() {
  if (!channel || !joined || !mine) return;
  if (mine === "invisible") await channel.untrack();
  else await channel.track({ status: mine, at: Date.now() } satisfies Meta);
}

/** 내 상태가 정해지거나 바뀔 때 부른다 (헤더의 내 이름 메뉴가 부른다) */
export function setMyPresence(status: Status) {
  mine = status;
  void ensure().then(apply);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  void ensure();
  return () => void listeners.delete(fn);
}

/** 남의 상태. 접속자 채널에 없으면 offline */
export function usePresenceStatus(userId: string): DisplayStatus {
  return useSyncExternalStore(
    subscribe,
    () => statuses.get(userId) ?? "offline",
    () => "offline",
  );
}
