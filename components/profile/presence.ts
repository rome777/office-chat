// ② 회사 전체 접속자 채널 — 남의 상태 점(온라인·자리 비움·방해 금지·오프라인)을 여기서 받는다.
// DB 의 status 는 남이 읽을 수 없다 (20260930150000_status_privacy). 접속 중인 사람만 이 채널에 자기 상태를 실어 보내고,
// "오프라인으로 표시"(invisible)면 들어가지 않는다 → 남에게는 접속을 끊은 사람과 똑같이 보인다.
// 채널 하나를 탭 전체가 나눠 쓴다. 들어가는 키는 내 id 라서, 같은 사람이 탭을 여러 개 열어도 한 사람이다 (가장 최근에 보낸 상태를 쓴다).
// 한계: 키와 at 을 보내는 쪽이 정하는 공개 채널이라, 로그인한 사람이 남의 id 로 들어가 그 사람의 점을 바꿀 수 있다 (TECH_SPEC 4절).
// 서버가 확인하려면 private 채널 + realtime.messages RLS 가 필요하다. 화면 표시일 뿐 권한과는 관계없다.
// 새로고침하거나 탭을 닫아도 서버에 옛 탭의 "온라인"이 몇 분씩 남는다 (2026-09-30 확인 — 4분 넘게 남은 것도 봄).
// 그러면 "오프라인으로 표시"를 골라도 옛 기록 때문에 온라인으로 보인다 → 접속 중인 탭은 30초마다 다시 보내고(at 갱신),
// 읽는 쪽은 75초 넘게 갱신이 없는 기록을 버린다. 페이지를 떠날 때도 나가 보지만(pagehide), 새로고침은 그 전에 페이지가 닫혀
// 대개 서버에 닿지 않는다 → 새로고침 직후 최대 75초는 옛 탭 기록 때문에 "오프라인으로 표시"가 늦게 먹을 수 있다.

import { useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { DisplayStatus, Status } from "@/lib/types/profile";
import { getSupabase } from "@/lib/supabase";
import { refreshMyStatus } from "./profileSource";

// 접속자 수처럼 모두가 같은 이름으로 들어가야 하는 구독이라 이름에 꼬리를 붙이지 않는다 (TECH_SPEC 13절)
const CHANNEL = "presence:company";
const REFRESH_MS = 30_000; // 접속 중인 탭이 상태를 다시 보내는 주기
const STALE_MS = 75_000; // 이만큼 갱신이 없는 기록은 떠난 탭으로 본다 (주기 두 번 반 — 한 번 늦어도 버리지 않게)

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
  startTimer();
  if (channel || starting) return;
  starting = true;
  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id;
    if (!id) return;
    // 같은 이름의 채널이 남아 있으면 supabase.channel() 이 새로 만들지 않고 그것을 돌려주고, 거기에 .on() 을 붙이면
    // "cannot add presence callbacks after subscribe()" 로 멈춘다 (TECH_SPEC 13절). 계정을 바꾼 직후·개발 서버 코드 반영(HMR) 뒤에
    // 옛 채널이 남는다 → 먼저 지운다 (HMR 로 남은 옛 채널이 계속 "온라인"을 보내던 것도 같이 없어진다)
    for (const old of supabase.getChannels()) {
      if (old.topic === `realtime:${CHANNEL}`) await supabase.removeChannel(old);
    }
    const ch = supabase.channel(CHANNEL, { config: { presence: { key: id } } });
    channelUser = id;
    ch.on("presence", { event: "sync" }, () => recompute(ch)).subscribe((s) => {
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

// 접속자 채널의 기록 → 사람별 상태. 오래된 기록은 버리고, 한 사람에 기록이 여럿이면(탭 여러 개) 가장 최근 것을 쓴다
function recompute(ch: RealtimeChannel) {
  const fresh = Date.now() - STALE_MS;
  const next = new Map<string, DisplayStatus>();
  for (const [key, metas] of Object.entries(ch.presenceState<Meta>())) {
    const live = metas.filter((m) => (m.at ?? 0) > fresh);
    if (live.length === 0) continue;
    const latest = live.reduce((a, b) => (b.at > a.at ? b : a));
    if (latest.status === "online" || latest.status === "away" || latest.status === "dnd") next.set(key, latest.status);
  }
  // 바뀌었을 때만 새 Map 으로 알린다 (30초마다 다시 셀 때 화면이 괜히 다시 그려지지 않게)
  const same = next.size === statuses.size && [...next].every(([k, v]) => statuses.get(k) === v);
  if (same) return;
  statuses = next;
  listeners.forEach((fn) => fn());
}

// 30초마다: 내 기록을 새로 보내고(at 갱신), 남의 오래된 기록을 버린다. 페이지를 떠날 때는 나간다
let timerStarted = false;
function startTimer() {
  if (timerStarted || typeof window === "undefined") return;
  timerStarted = true;
  setInterval(() => {
    // 다른 브라우저·기기에서 "오프라인으로 표시"를 골랐으면 이 탭도 따라 나가야 한다 → 내 상태를 먼저 다시 읽는다
    // (바뀌었으면 헤더가 setMyPresence 로 알려 주고, 안 바뀌었으면 지금 상태로 다시 보낸다)
    void refreshMyStatus().then(apply);
    if (channel) recompute(channel);
  }, REFRESH_MS);
  window.addEventListener("pagehide", () => void channel?.untrack());
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

/** 지금 접속한 사람 전체 (사람 id → 상태). 채널 헤더가 접속 인원을 셀 때 쓴다. 바뀔 때만 새 Map 이다 */
export function usePresenceMap(): ReadonlyMap<string, DisplayStatus> {
  return useSyncExternalStore(subscribe, () => statuses, () => EMPTY_MAP);
}

const EMPTY_MAP: ReadonlyMap<string, DisplayStatus> = new Map();

/** 남의 상태. 접속자 채널에 없으면 offline */
export function usePresenceStatus(userId: string): DisplayStatus {
  return useSyncExternalStore(
    subscribe,
    () => statuses.get(userId) ?? "offline",
    () => "offline",
  );
}
