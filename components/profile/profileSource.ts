// ② 내 프로필 DB 창구. 헤더의 내 이름(UserMenu)과 내 프로필 패널이 같은 값을 나눠 쓴다 —
// 한쪽에서 상태·사진을 바꾸면 다른 쪽도 바로 바뀐다.
// 본인이 고칠 수 있는 것은 avatar·status·status_message 와 연락처뿐이다 (이름·부서·직급은 DB 가 막는다).

import { useSyncExternalStore } from "react";
import type { AvatarValue, Contact, DisplayStatus, MyProfile, Status } from "@/lib/types/profile";
import { getSupabase } from "@/lib/supabase";

// status 는 남이 못 읽는 칸이라 여기 넣으면 42501 이다 → my_status() 로 따로 읽는다 (20260930150000_status_privacy)
const COLUMNS = "id, handle, display_name, department, title, org_unit_id, avatar, status_message";
const BUCKET = "avatars";
export const STATUS_MESSAGE_MAX = 60;
export const PHONE_PATTERN = /^[0-9+() -]{0,20}$/; // DB 제약 profile_contacts_phone 과 같다

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  online: "온라인",
  away: "자리 비움",
  dnd: "방해 금지",
  invisible: "오프라인으로 표시",
  offline: "오프라인",
};

type State = { profile: MyProfile | null; contact: Contact | null; error: string | null };

let state: State = { profile: null, contact: null, error: null };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

async function load() {
  const supabase = getSupabase();
  const { data: session } = await supabase.auth.getSession();
  const user = session.session?.user;
  if (!user) return;
  const [profile, status, contact] = await Promise.all([
    supabase.from("profiles").select(COLUMNS).eq("id", user.id).maybeSingle(),
    readMyStatus(user.id),
    supabase.from("profile_contacts").select("phone, is_public").eq("user_id", user.id).maybeSingle(),
  ]);
  if (profile.error || !profile.data || status.error) {
    set({ error: profile.error?.message ?? status.error?.message ?? "내 프로필을 찾지 못했습니다" });
    return;
  }
  // 연락처를 못 읽었는데 빈 값으로 두면, 그대로 저장할 때 원래 값을 덮어쓴다 → 오류로 보인다
  if (contact.error) {
    set({ error: contact.error.message });
    return;
  }
  set({
    profile: { ...(profile.data as Omit<MyProfile, "email" | "status">), status: (status.data as Status | null) ?? "online", email: user.email ?? null },
    // 처음 적는 연락처는 비공개가 기본이다 (개인정보)
    contact: (contact.data as Contact | null) ?? { phone: "", is_public: false },
    error: null,
  });
}

// my_status() 가 아직 없는 DB(마이그레이션 적용 전, PGRST202)면 예전처럼 칸을 직접 읽는다 — 코드를 먼저 배포해도 끊기지 않게
async function readMyStatus(id: string): Promise<{ data: Status | null; error: { message: string } | null }> {
  const supabase = getSupabase();
  const rpc = await supabase.rpc("my_status");
  if (!rpc.error) return { data: rpc.data as Status | null, error: null };
  if (rpc.error.code !== "PGRST202") return { data: null, error: rpc.error };
  const old = await supabase.from("profiles").select("status").eq("id", id).maybeSingle();
  // 적용 직후 PostgREST 가 새 함수를 아직 모르는 잠깐 동안은 칸도 42501 이다 → 오류로 막지 않고 온라인으로 둔다
  if (old.error?.code === "42501") return { data: null, error: null };
  return { data: (old.data?.status as Status | undefined) ?? null, error: old.error };
}

/** DB 의 내 상태를 다시 읽어 바뀌었으면 맞춘다. 다른 브라우저·기기·주소(운영 URL 등)에서 바꾼 상태는 BroadcastChannel 로
 *  오지 않아서, 창에 초점이 돌아올 때와 접속자 채널이 30초마다 다시 보낼 때(presence) 부른다 */
export async function refreshMyStatus() {
  const me = state.profile;
  if (!me) return;
  const { data } = await readMyStatus(me.id);
  const now = state.profile;
  if (data && now && now.id === me.id && now.status !== data) set({ profile: { ...now, status: data } });
}

function startLoad() {
  loading ??= load()
    .catch((e: unknown) => set({ error: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      loading = null;
    });
}

// 같은 사람의 다른 탭에 바뀐 값을 알린다 — 한 탭에서 "오프라인으로 표시"를 골랐는데 다른 탭이 계속 온라인을 보내면 숨겨지지 않는다
type TabPatch = { id: string; patch: Partial<Pick<MyProfile, "avatar" | "status" | "status_message">> };
let tabs: BroadcastChannel | null = null;

// 다른 탭에서 다른 계정으로 로그인하면 이 탭도 세션이 바뀐다 (AuthGate 는 새로고침하지 않는다) → 새 사람으로 다시 불러온다
let watching = false;
function watchAuth() {
  if (watching) return;
  watching = true;
  // 다른 기기(폰 등)에서 바꾼 상태는 BroadcastChannel 로 오지 않는다 → 이 창에 초점이 돌아오면 다시 읽는다
  window.addEventListener("focus", () => void refreshMyStatus());
  if (typeof BroadcastChannel !== "undefined") {
    tabs = new BroadcastChannel("office-chat:my-profile");
    tabs.onmessage = (e: MessageEvent<TabPatch>) => {
      if (state.profile && state.profile.id === e.data.id) set({ profile: { ...state.profile, ...e.data.patch } });
    };
  }
  getSupabase().auth.onAuthStateChange((_event, session) => {
    const id = session?.user.id ?? null;
    if (state.profile && state.profile.id !== id) {
      set({ profile: null, contact: null, error: null });
      if (id) setTimeout(startLoad, 0); // 콜백 안에서 곧바로 supabase 를 부르면 멈출 수 있다 (supabase-js 안내)
    }
  });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  watchAuth();
  if (!state.profile) startLoad();
  return () => void listeners.delete(fn);
}

const EMPTY: State = { profile: null, contact: null, error: null };

export function useMyProfile(): State {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

/** 상태·상태 메시지·사진을 바꾼다. 화면은 먼저 바꾸고, DB 가 거부하면 되돌린다.
 *  되돌릴 때는 이번에 바꾼 칸만, 그사이 다른 저장이 그 칸을 또 바꾸지 않았을 때만 되돌린다 (동시에 저장한 다른 칸을 지우지 않게) */
export async function updateMyProfile(patch: Partial<Pick<MyProfile, "avatar" | "status" | "status_message">>) {
  const before = state.profile;
  if (!before) return;
  set({ profile: { ...before, ...patch } });
  // RLS 가 막으면 오류 없이 0건이다 → 돌려받은 행 수로 확인한다
  const { data, error } = await getSupabase().from("profiles").update(patch).eq("id", before.id).select("id");
  if (error || data?.length !== 1) {
    const now = state.profile;
    if (now && now.id === before.id) {
      const back = { ...now };
      for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
        if (now[key] === patch[key]) (back as Record<string, unknown>)[key] = before[key];
      }
      set({ profile: back });
    }
    throw new Error(error?.message ?? "저장되지 않았습니다. 새로고침해 보세요");
  }
  tabs?.postMessage({ id: before.id, patch } satisfies TabPatch);
}

export async function saveContact(next: Contact) {
  const { data, error } = await getSupabase()
    .from("profile_contacts")
    .upsert(next, { onConflict: "user_id" })
    .select("phone, is_public")
    .single();
  if (error) throw new Error(error.message);
  set({ contact: data as Contact });
}

/** 사진 파일 경로 ("photo:" 뒤) → 공개 주소 */
export function avatarPhotoUrl(avatar: AvatarValue): string | null {
  if (!avatar?.startsWith("photo:")) return null;
  return getSupabase().storage.from(BUCKET).getPublicUrl(avatar.slice("photo:".length)).data.publicUrl;
}

/** 잘라 둔 사진을 올리고 내 사진으로 정한다. 전에 올린 사진은 지운다 */
export async function uploadMyPhoto(image: Blob, ext: "webp" | "jpg") {
  const me = state.profile;
  if (!me) throw new Error("내 프로필을 아직 불러오지 못했습니다");
  const path = `${me.id}/${randomName()}.${ext}`;
  const storage = getSupabase().storage.from(BUCKET);
  const { error } = await storage.upload(path, image, {
    contentType: ext === "webp" ? "image/webp" : "image/jpeg",
    cacheControl: "31536000", // 파일 이름이 매번 달라 오래 두어도 된다
  });
  if (error) throw new Error(error.message);
  const old = me.avatar;
  try {
    await updateMyProfile({ avatar: `photo:${path}` });
  } catch (e) {
    await storage.remove([path]);
    throw e;
  }
  await removeOldPhoto(old);
}

export async function chooseCharacter(id: string) {
  const old = state.profile?.avatar ?? null;
  await updateMyProfile({ avatar: `char:${id}` });
  await removeOldPhoto(old);
}

// 못 지워도 사진은 바뀌었으니 오류를 알리지 않는다 (보관함에 옛 파일이 남을 뿐)
async function removeOldPhoto(old: AvatarValue) {
  if (!old?.startsWith("photo:")) return;
  await getSupabase().storage.from(BUCKET).remove([old.slice("photo:".length)]).catch(() => undefined);
}

/** 지금 비밀번호로 한 번 더 로그인해 본인인지 확인한 뒤 바꾼다 */
export async function changePassword(current: string, next: string) {
  const email = state.profile?.email;
  if (!email) throw new Error("로그인 메일을 알 수 없습니다");
  const supabase = getSupabase();
  const check = await supabase.auth.signInWithPassword({ email, password: current });
  if (check.error) throw new Error("지금 비밀번호가 맞지 않습니다");
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) throw new Error(passwordError(error.message));
}

function passwordError(raw: string): string {
  if (/different from the old/i.test(raw)) return "지금 비밀번호와 다른 비밀번호를 쓰세요";
  if (/at least|characters/i.test(raw)) return "비밀번호가 너무 짧습니다";
  if (/weak|pwned|leaked/i.test(raw)) return "너무 쉬운 비밀번호입니다. 다른 비밀번호를 쓰세요";
  return raw;
}

// IP 로 접속하면 crypto.randomUUID 가 없다 (TECH_SPEC 13절) → getRandomValues 로 만든다
function randomName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
