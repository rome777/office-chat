// 채팅 개편 기능 권한 자동 확인 (원격 Supabase, 20260930170000_chat_extras.sql).
// 실행: npm run check:chat
// 즐겨찾기·채널 설명 수정·고정 메시지·리액션·채널별 알림 끄기를 가상 사용자 A·B·C 로 확인한다.
// A 가 비공개 채널 X 를 만들고 B 를 넣는다. C 는 멤버가 아니다. 끝나면 사용자·채널을 모두 지운다.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error("Supabase 환경 변수가 없습니다. npx vercel env pull .env.local 을 먼저 실행하세요.");
  process.exit(1);
}

const run = randomUUID().slice(0, 4);
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, noSession);
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
const made = { users: [], channels: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeUser(tag) {
  const email = `chat-check-${run}-${tag.toLowerCase()}@example.com`;
  const handle = `ct${tag}${run}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { handle, display_name: `채팅검사${tag}` },
  });
  if (error) throw error;
  made.users.push(data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const sb = createClient(url, anonKey, noSession);
  const { error: e2 } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (e2) throw e2;
  return { id: data.user.id, handle, sb };
}

const GENERAL = "00000000-0000-0000-0000-000000000001"; // #일반 (부서 채널 — 회사 조직에 걸려 있다)

const send = (who, channelId, body) =>
  who.sb.from("messages").insert({ client_id: randomUUID(), channel_id: channelId, body }).select("id").single();

try {
  const A = await makeUser("A");
  const B = await makeUser("B");
  const C = await makeUser("C");
  const X = await A.sb.from("channels").insert({ name: `채팅검사-${run}`, type: "private" }).select().single();
  if (X.error) throw X.error;
  const ch = X.data.id;
  made.channels.push(ch);
  const addB = await admin.from("memberships").insert({ channel_id: ch, user_id: B.id });
  if (addB.error) throw addB.error;
  const M = await send(A, ch, "고정·리액션 검사용 메시지");
  if (M.error) throw M.error;
  const mid = M.data.id;

  // ── 즐겨찾기 ──
  const aFav = await A.sb.from("channel_favorites").insert({ channel_id: ch }).select("user_id").single();
  check("멤버는 즐겨찾기에 넣는다 (본인 것으로)", !aFav.error && aFav.data.user_id === A.id, `(${aFav.error?.message ?? ""})`);
  const bSeesA = await B.sb.from("channel_favorites").select("user_id").eq("channel_id", ch);
  check("남의 즐겨찾기는 안 보인다", bSeesA.data?.length === 0, `(${bSeesA.data?.length})`);
  const cFav = await C.sb.from("channel_favorites").insert({ channel_id: ch }).select();
  check("멤버가 아닌 채널은 즐겨찾기에 못 넣는다", !!cFav.error, `(${cFav.error?.code})`);
  const forgeFav = await B.sb.from("channel_favorites").insert({ channel_id: ch, user_id: A.id }).select();
  check("남의 즐겨찾기를 대신 만들 수 없다 (컬럼 권한)", !!forgeFav.error, `(${forgeFav.error?.code})`);

  // ── 채널 설명·이름 ──
  const aDesc = await A.sb.from("channels").update({ description: "검사 채널입니다" }).eq("id", ch).select("id");
  check("리더(만든 사람)는 설명을 고친다", aDesc.data?.length === 1, `(${aDesc.error?.message ?? aDesc.data?.length})`);
  // 20260930210000_channel_leaders.sql — 이름·설명은 리더(만든 사람으로 시작)만 고친다
  const bDesc = await B.sb.from("channels").update({ description: "몰래" }).eq("id", ch).select("id");
  check("리더가 아니면 설명을 못 고친다 (0건)", !bDesc.error && bDesc.data?.length === 0, `(${bDesc.error?.code ?? bDesc.data?.length})`);
  const genDesc = await B.sb.from("channels").update({ description: "몰래" }).eq("id", GENERAL).select("id");
  check("부서 채널(#일반)은 멤버라도 설명을 못 고친다 (0건)", !genDesc.error && (genDesc.data ?? []).length === 0, `(${genDesc.error?.code ?? genDesc.data?.length})`);
  const aName = await A.sb.from("channels").update({ name: `채팅검사2-${run}` }).eq("id", ch).select("name");
  check("리더(만든 사람)는 이름을 고친다", aName.data?.[0]?.name === `채팅검사2-${run}`, `(${aName.error?.message ?? ""})`);
  const tooLong = await A.sb.from("channels").update({ description: "가".repeat(121) }).eq("id", ch).select("id");
  check("설명 121자는 거부", !!tooLong.error, `(${tooLong.error?.code})`);
  const aType = await A.sb.from("channels").update({ type: "public" }).eq("id", ch).select("id");
  check("채널 종류는 못 바꾼다 (컬럼 권한)", !!aType.error, `(${aType.error?.code})`);

  // ── 고정 메시지 ──
  const bPin = await B.sb.rpc("toggle_pin", { p_message: mid });
  check("멤버는 남의 메시지도 고정한다", bPin.data === true, `(${bPin.error?.message ?? bPin.data})`);
  const aPins = await A.sb.from("pinned_messages").select("message_id, pinned_by").eq("channel_id", ch);
  check("다른 멤버도 고정 메시지를 본다", aPins.data?.length === 1 && aPins.data[0].pinned_by === B.id);
  const cPins = await C.sb.from("pinned_messages").select("message_id").eq("channel_id", ch);
  check("멤버가 아니면 고정 메시지 0건", cPins.data?.length === 0);
  const cPin = await C.sb.rpc("toggle_pin", { p_message: mid });
  check("멤버가 아니면 고정 못 한다", !!cPin.error, `(${cPin.error?.code})`);
  const directPin = await A.sb.from("pinned_messages").insert({ message_id: mid, channel_id: ch });
  check("고정 표에 직접 넣을 수 없다 (toggle_pin 으로만)", !!directPin.error, `(${directPin.error?.code})`);
  const unpin = await A.sb.rpc("toggle_pin", { p_message: mid });
  check("다시 누르면 고정이 풀린다", unpin.data === false, `(${unpin.error?.message ?? unpin.data})`);

  // ── 리액션 ──
  const bReact = await B.sb.rpc("toggle_reaction", { p_message: mid, p_emoji: "👍" });
  check("멤버는 리액션을 단다", bReact.data === true, `(${bReact.error?.message ?? bReact.data})`);
  const aReacts = await A.sb.from("message_reactions").select("user_id, emoji").eq("channel_id", ch).is("removed_at", null);
  check("다른 멤버도 리액션을 본다", aReacts.data?.length === 1 && aReacts.data[0].user_id === B.id);
  const cReacts = await C.sb.from("message_reactions").select("user_id").eq("channel_id", ch);
  check("멤버가 아니면 리액션 0건", cReacts.data?.length === 0);
  const cReact = await C.sb.rpc("toggle_reaction", { p_message: mid, p_emoji: "👍" });
  check("멤버가 아니면 리액션을 못 단다", !!cReact.error, `(${cReact.error?.code})`);
  const badEmoji = await B.sb.rpc("toggle_reaction", { p_message: mid, p_emoji: "💩" });
  check("정해진 이모지가 아니면 거부", !!badEmoji.error, `(${badEmoji.error?.code})`);
  const forgeReact = await B.sb.from("message_reactions").insert({ message_id: mid, user_id: A.id, emoji: "👍", channel_id: ch });
  check("리액션 표에 직접 넣을 수 없다 (남 이름으로 못 단다)", !!forgeReact.error, `(${forgeReact.error?.code})`);
  const bOff = await B.sb.rpc("toggle_reaction", { p_message: mid, p_emoji: "👍" });
  const afterOff = await A.sb.from("message_reactions").select("user_id").eq("channel_id", ch).is("removed_at", null);
  check("다시 누르면 리액션이 떨어진다", bOff.data === false && afterOff.data?.length === 0, `(${bOff.error?.message ?? bOff.data})`);

  // ── 채널별 알림 끄기 ──
  const bMute = await B.sb.from("channel_mutes").insert({ channel_id: ch }).select("user_id").single();
  check("멤버는 채널 알림을 끈다", !bMute.error && bMute.data.user_id === B.id, `(${bMute.error?.message ?? ""})`);
  const cMute = await C.sb.from("channel_mutes").insert({ channel_id: ch }).select();
  check("멤버가 아닌 채널은 알림 설정을 못 만든다", !!cMute.error, `(${cMute.error?.code})`);
  const muted = await send(A, ch, `@${B.handle} 알림 끈 동안`);
  await sleep(500);
  const nMuted = await admin.from("notifications").select("id").eq("user_id", B.id).eq("message_id", muted.data.id);
  check("알림을 끈 채널의 멘션은 알림이 안 생긴다", nMuted.data?.length === 0, `(${nMuted.data?.length})`);
  const bUnmute = await B.sb.from("channel_mutes").delete().eq("channel_id", ch).select("user_id");
  const loud = await send(A, ch, `@${B.handle} 다시 켠 뒤`);
  await sleep(500);
  const nLoud = await admin.from("notifications").select("id").eq("user_id", B.id).eq("message_id", loud.data.id);
  check("알림을 다시 켜면 멘션 알림이 생긴다", bUnmute.data?.length === 1 && nLoud.data?.length === 1, `(${nLoud.data?.length})`);

  // ── 나가면 개인 설정도 지워진다 ──
  await B.sb.from("channel_favorites").insert({ channel_id: ch });
  await B.sb.from("channel_mutes").insert({ channel_id: ch });
  await admin.from("memberships").delete().eq("channel_id", ch).eq("user_id", B.id);
  const leftFav = await admin.from("channel_favorites").select("user_id").eq("user_id", B.id).eq("channel_id", ch);
  const leftMute = await admin.from("channel_mutes").select("user_id").eq("user_id", B.id).eq("channel_id", ch);
  check("채널에서 빠지면 그 채널의 즐겨찾기·알림 설정도 지워진다", leftFav.data?.length === 0 && leftMute.data?.length === 0);
} catch (e) {
  results.push(`FAIL  검사 오류: ${e.message ?? e}`);
} finally {
  const errors = [];
  // 채널을 지우면 메시지·고정·리액션·즐겨찾기·알림 설정이 같이 지워진다 (메시지가 남으면 사용자를 못 지운다)
  if (made.channels.length) {
    const { error } = await admin.from("channels").delete().in("id", made.channels);
    if (error) errors.push(error.message);
  }
  for (const id of made.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(error.message);
  }
  console.log(errors.length ? `정리 실패: ${errors.join(" / ")}` : `정리: 사용자 ${made.users.length}명, 채널 ${made.channels.length}개`);
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
