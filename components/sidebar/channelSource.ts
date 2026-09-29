// ② 채널 목록 데이터. 화면은 이 파일의 함수만 부른다.
// 지금은 브라우저 메모리의 가짜 데이터다 (새로고침하면 처음 상태로 돌아간다).
// WU-02 로 테이블이 생기면 각 함수 안만 Supabase 호출로 바꾼다:
//   listMyChannels → memberships 에 내가 있는 channels (type 이 dm 이 아닌 것)
//   listPublicChannels → type = 'public' 인 channels + 내 가입 여부
//   joinChannel → memberships insert (RLS: 공개 채널만 본인 가입 가능)
//   createChannel → **create_channel(name, type) 함수 (security definer) 가 필요하다.**
//     비공개 채널의 멤버 추가는 관리자만 할 수 있어서(TECH_SPEC 5절), channels insert 뒤
//     memberships insert 를 따로 부르면 두 번째가 거부돼 멤버 없는 채널이 남는다. create_dm 처럼 한 번에 만든다.
//   member_count → memberships 는 같은 채널 멤버만 읽을 수 있어, 가입 안 한 공개 채널은 0명으로 보인다.
//     멤버 수만 돌려주는 함수(security definer)나 뷰를 WU-02 에서 함께 만든다.
// 가짜 데이터도 같은 규칙(비공개 채널은 멤버에게만 보임, 공개 채널만 스스로 가입)을 지킨다.

import type { ChannelSummary, ChannelType } from "@/lib/types/channel";
import { DEMO_ME_ID } from "@/components/people/directory";

export const NAME_MAX = 30;

/** Step 1 메시지가 모두 들어가는 채널. id 는 WorkspaceContext 의 기본 채널과 같아야 한다.
 *  DB 로 바꾸면 channels 의 id 가 uuid 가 되므로, 시드의 #일반 id 와 기본 채널을 함께 맞춘다 */
export const GENERAL_ID = "general";

type Row = { id: string; name: string; type: ChannelType; created_by: string; created_at: string };

const channels: Row[] = [];
const members: { channel_id: string; user_id: string }[] = [];
const listeners = new Set<() => void>();

function seed() {
  const now = new Date().toISOString();
  const add = (id: string, name: string, type: ChannelType, by: string, users: string[]) => {
    channels.push({ id, name, type, created_by: by, created_at: now });
    for (const user_id of users) members.push({ channel_id: id, user_id });
  };
  add(GENERAL_ID, "일반", "public", "demo-admin", [
    "demo-admin",
    "demo-a",
    "demo-b",
    "demo-c",
    "demo-d",
    "demo-e",
    "demo-f",
  ]);
  add("ch-project", "프로젝트", "public", "demo-admin", ["demo-admin", "demo-a", "demo-b"]);
  add("ch-design", "디자인", "public", "demo-d", ["demo-d", "demo-f"]);
  add("ch-sales", "영업", "public", "demo-c", ["demo-c"]);
  // 비공개 — B 는 멤버가 아니라서 목록·찾기 어디에도 보이면 안 된다
  add("ch-mgmt", "경영회의", "private", "demo-admin", ["demo-admin", "demo-c"]);
}
seed();

/** 목록이 바뀌면 알려 준다 (왼쪽 칸과 헤더의 채널 목록이 함께 갱신되도록) */
export function subscribeChannels(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

const isMember = (channelId: string, userId: string) =>
  members.some((m) => m.channel_id === channelId && m.user_id === userId);

const summarize = (c: Row, me: string): ChannelSummary => ({
  ...c,
  member_count: members.filter((m) => m.channel_id === c.id).length,
  joined: isMember(c.id, me),
});

/** 저장할 이름: 한글 조합 방식 통일(NFC), 보이지 않는 글자 제거, 공백 정리 */
export const cleanName = (raw: string) =>
  raw
    .normalize("NFC")
    .replace(/[​-‍⁠﻿]/g, "")
    .trim()
    .replace(/\s+/g, " ");

/** 이름 비교용 (대소문자 무시) */
const norm = (name: string) => cleanName(name).toLowerCase();

/** 채널 이름 검사. 문제가 없으면 null. 글자 수는 이모지도 한 글자로 센다 */
export function channelNameProblem(raw: string): string | null {
  const name = cleanName(raw);
  if (!name) return "채널 이름을 적어 주세요";
  if ([...name].length > NAME_MAX) return `채널 이름은 ${NAME_MAX}자까지입니다`;
  if (name.startsWith("#")) return "# 은 빼고 적어 주세요";
  return null;
}

// ── 화면이 부르는 함수 ──────────────────────────────────────

/** 내가 가입한 채널 (DM 제외). #일반을 맨 위에, 나머지는 이름순 */
export async function listMyChannels(me = DEMO_ME_ID): Promise<ChannelSummary[]> {
  return channels
    .filter((c) => c.type !== "dm" && isMember(c.id, me))
    .sort((a, b) =>
      a.id === GENERAL_ID ? -1 : b.id === GENERAL_ID ? 1 : a.name.localeCompare(b.name, "ko"),
    )
    .map((c) => summarize(c, me));
}

/** 공개 채널 전부 (가입 안 한 것 포함). 이름 일부로 거른다 */
export async function listPublicChannels(query = "", me = DEMO_ME_ID): Promise<ChannelSummary[]> {
  const q = norm(query);
  return channels
    .filter((c) => c.type === "public" && (!q || norm(c.name).includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .map((c) => summarize(c, me));
}

/** 만든 사람은 바로 멤버가 된다. 내가 볼 수 있는 채널(공개 + 내가 멤버인 비공개) 중에
 *  같은 이름(대소문자·공백 무시)이 있으면 거부한다 — 안 보이는 비공개 채널의 존재를 알려 주지 않으려고 */
export async function createChannel(
  input: { name: string; type: "public" | "private" },
  me = DEMO_ME_ID,
): Promise<ChannelSummary> {
  const problem = channelNameProblem(input.name);
  if (problem) throw new Error(problem);
  const name = cleanName(input.name);
  const visible = (c: Row) => c.type === "public" || (c.type === "private" && isMember(c.id, me));
  if (channels.some((c) => visible(c) && norm(c.name) === norm(name))) {
    throw new Error("같은 이름의 채널이 이미 있습니다");
  }
  const row: Row = {
    id: `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    type: input.type,
    created_by: me,
    created_at: new Date().toISOString(),
  };
  channels.push(row);
  members.push({ channel_id: row.id, user_id: me });
  notify();
  return summarize(row, me);
}

/** 공개 채널만 스스로 가입할 수 있다. 이미 멤버면 그대로 둔다 */
export async function joinChannel(channelId: string, me = DEMO_ME_ID): Promise<ChannelSummary> {
  const row = channels.find((c) => c.id === channelId);
  if (!row || (row.type !== "public" && !isMember(channelId, me))) {
    throw new Error("채널을 찾을 수 없습니다");
  }
  if (!isMember(channelId, me)) {
    members.push({ channel_id: channelId, user_id: me });
    notify();
  }
  return summarize(row, me);
}
