// DB v1 권한·제약 자동 확인 (WU-02 완료 조건, 원격 Supabase).
// 실행: npm run check:db  (.env.local 의 Supabase 값과 service role 키를 쓴다)
//
// 가상 사용자 A·B·C·관리자를 service role 로 만들고, 비밀번호 없이 일회용 로그인 토큰(magic link)으로 접속한다.
// 끝나면 이 검사가 만든 사용자·채널·회의·회의실·관리 기록을 모두 지운다 (실패해도 지운다).
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

const GENERAL = "00000000-0000-0000-0000-000000000001"; // Step 1 임시 호환의 #일반
const run = randomUUID().slice(0, 4);
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, noSession);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
const made = { users: [], channels: [], rooms: [], events: [], realtime: [] };

async function makeUser(tag, role) {
  const email = `db-check-${run}-${tag.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { handle: `chk${tag}${run}`, display_name: `검사${tag}`, department: "검사팀" },
  });
  if (error) throw error;
  made.users.push(data.user.id);
  if (role) await admin.from("profiles").update({ role }).eq("id", data.user.id);

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const sb = createClient(url, anonKey, noSession);
  const { data: s, error: e2 } = await sb.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "email",
  });
  if (e2) throw e2;
  await sb.realtime.setAuth(s.session.access_token);
  return { id: data.user.id, sb };
}

// 구독을 열고 받은 messages INSERT 를 모은다
async function listen(sb, label) {
  const received = [];
  const channel = sb
    .channel(`db-check-${label}-${randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) =>
      received.push(p.new),
    );
  await new Promise((res, rej) =>
    channel.subscribe((s, err) =>
      s === "SUBSCRIBED" ? res() : s !== "CLOSED" && rej(err ?? new Error(s)),
    ),
  );
  made.realtime.push({ sb, channel });
  return received;
}

const send = (sb, channel_id, body, client_id = randomUUID(), extra = {}) =>
  sb.from("messages").upsert({ client_id, channel_id, body, ...extra }, { onConflict: "client_id", ignoreDuplicates: true }).select();

try {
  const A = await makeUser("A");
  const B = await makeUser("B");
  const C = await makeUser("C");
  const M = await makeUser("M", "admin"); // 관리자
  const anon = createClient(url, anonKey, noSession);

  // ── 가입·프로필 ──
  const { data: profs } = await admin.from("profiles").select("id, handle, role").in("id", made.users);
  check("가입하면 profiles 행이 생긴다", profs?.length === 4, `(${profs?.length}건)`);
  const roleUp = await A.sb.from("profiles").update({ role: "admin" }).eq("id", A.id).select("id"); // select() 는 * 라 status 권한 때문에 42501 이 난다
  check("본인 role 을 admin 으로 못 바꾼다", !!roleUp.error, `(${roleUp.error?.code})`);
  const nameUp = await A.sb.from("profiles").update({ display_name: "검사A2" }).eq("id", A.id).select("id");
  check("본인 이름은 고칠 수 없다 (인사 정보, 20260930130000_my_profile)", nameUp.error?.code === "42501", `(${nameUp.error?.code ?? "ok"})`);

  // ── 채널·멤버십 ──
  const X = await A.sb.from("channels").insert({ name: `검사X-${run}`, type: "public" }).select().single();
  if (X.error) throw X.error;
  made.channels.push(X.data.id);
  const P = await A.sb.from("channels").insert({ name: `검사P-${run}`, type: "private" }).select().single();
  if (P.error) throw P.error;
  made.channels.push(P.data.id);
  const fakeDm = await A.sb.from("channels").insert({ name: "x", type: "dm" }).select();
  check("DM 은 채널 insert 로 못 만든다", !!fakeDm.error, `(${fakeDm.error?.code})`);

  const join = await B.sb.from("memberships").insert({ channel_id: X.data.id, user_id: B.id }).select();
  check("공개 채널은 본인이 가입한다", !join.error, `(${join.error?.code ?? "ok"})`);
  const joinP = await B.sb.from("memberships").insert({ channel_id: P.data.id, user_id: B.id }).select();
  check("비공개 채널은 본인이 가입 못 한다", !!joinP.error, `(${joinP.error?.code})`);
  const cAddsB = await C.sb.from("memberships").insert({ channel_id: P.data.id, user_id: B.id }).select();
  check("멤버가 아니면 남을 채널에 못 넣는다", !!cAddsB.error, `(${cAddsB.error?.code})`);
  const pVisibleToC = await C.sb.from("channels").select("id").eq("id", P.data.id);
  check("비공개 채널은 멤버가 아니면 안 보인다", pVisibleToC.data?.length === 0);

  // ── 리더·부리더 (20260930210000_channel_leaders.sql) ──
  // 공개 Q·비공개 R 을 따로 만들어 확인한다 (X·P 는 뒤의 실시간·답글 검사가 쓴다)
  const invite = (u, channel, userId) => u.sb.from("memberships").insert({ channel_id: channel, user_id: userId }).select();
  const roleOf = async (channel, userId) =>
    (await admin.from("memberships").select("role").eq("channel_id", channel).eq("user_id", userId).maybeSingle()).data?.role ?? null;
  const kickBy = (u, channel, userId) => u.sb.from("memberships").delete().eq("channel_id", channel).eq("user_id", userId).select();
  const sub = (u, channel, userId, on) => u.sb.rpc("set_sub_leader", { p_channel: channel, p_user: userId, p_on: on });
  check("채널을 만든 사람은 리더다", (await roleOf(P.data.id, A.id)) === "leader" && (await roleOf(X.data.id, A.id)) === "leader");
  const aAddsB = await invite(A, P.data.id, B.id);
  check("리더는 비공개 채널에 남을 넣는다", aAddsB.data?.length === 1, `(${aAddsB.error?.code ?? "ok"})`);
  check("초대받은 사람은 일반 멤버다", (await roleOf(P.data.id, B.id)) === "member");
  const bAddsC = await invite(B, P.data.id, C.id);
  check("비공개 채널은 일반 멤버가 남을 못 넣는다", !!bAddsC.error, `(${bAddsC.error?.code})`);
  const withRight = await A.sb.from("memberships").insert({ channel_id: P.data.id, user_id: M.id, role: "leader" }).select();
  check("넣으면서 역할을 같이 쓸 수는 없다 (컬럼 권한)", !!withRight.error, `(${withRight.error?.code})`);
  const selfRole = await B.sb.from("memberships").update({ role: "leader" }).eq("channel_id", P.data.id).eq("user_id", B.id).select("user_id");
  const oldRight = await A.sb.from("memberships").update({ can_invite: true }).eq("channel_id", P.data.id).eq("user_id", B.id).select("user_id");
  check("역할·예전 초대 권한은 직접 못 고친다 (컬럼 권한)", !!selfRole.error && !!oldRight.error, `(${selfRole.error?.code}·${oldRight.error?.code})`);

  const Q = await A.sb.from("channels").insert({ name: `검사Q-${run}`, type: "public" }).select().single();
  if (Q.error) throw Q.error;
  made.channels.push(Q.data.id);
  await B.sb.from("memberships").insert({ channel_id: Q.data.id, user_id: B.id });
  const bAddsCQ = await invite(B, Q.data.id, C.id);
  check("공개 채널은 일반 멤버도 남을 넣는다", bAddsCQ.data?.length === 1, `(${bAddsCQ.error?.code ?? "ok"})`);
  const bNameQ = await B.sb.from("channels").update({ description: "몰래" }).eq("id", Q.data.id).select("id");
  check("공개 채널이라도 이름·설명은 리더만 고친다 (0건)", !bNameQ.error && (bNameQ.data ?? []).length === 0, `(${bNameQ.error?.code ?? bNameQ.data?.length})`);

  const R = await A.sb.from("channels").insert({ name: `검사R-${run}`, type: "private" }).select().single();
  if (R.error) throw R.error;
  made.channels.push(R.data.id);
  const r = R.data.id;
  await invite(A, r, B.id);
  await invite(A, r, C.id);
  const bSubsC = await sub(B, r, C.id, true);
  check("리더가 아니면 부리더를 못 정한다", bSubsC.error?.code === "42501", `(${bSubsC.error?.code ?? "ok"})`);
  const aSubsB = await sub(A, r, B.id, true);
  check("리더는 부리더를 정한다", !aSubsB.error && (await roleOf(r, B.id)) === "sub", `(${aSubsB.error?.message ?? "ok"})`);
  const aSubsC = await sub(A, r, C.id, true);
  check("부리더는 멤버 10명당 1명까지 (3명 → 1명)", aSubsC.error?.code === "23514" && (await roleOf(r, C.id)) === "member", `(${aSubsC.error?.code ?? "ok"})`);
  const bAddsM = await invite(B, r, M.id);
  check("부리더는 비공개 채널에 남을 넣는다", bAddsM.data?.length === 1, `(${bAddsM.error?.code ?? "ok"})`);
  const cKicksM = await kickBy(C, r, M.id);
  check("일반 멤버는 남을 못 내보낸다 (0건)", (cKicksM.data ?? []).length === 0);
  const subKicksLeader = await kickBy(B, r, A.id);
  check("부리더는 리더를 못 내보낸다 (0건)", (subKicksLeader.data ?? []).length === 0 && (await roleOf(r, A.id)) === "leader");
  const bKicksM = await kickBy(B, r, M.id);
  check("부리더는 일반 멤버를 내보낸다", bKicksM.data?.length === 1, `(${bKicksM.error?.code ?? bKicksM.data?.length})`);
  const bDescR = await B.sb.from("channels").update({ description: "부리더가 고침" }).eq("id", r).select("id");
  check("부리더는 이름·설명을 못 고친다 (0건)", !bDescR.error && (bDescR.data ?? []).length === 0);
  const aDescR = await A.sb.from("channels").update({ description: "리더가 고침" }).eq("id", r).select("id");
  check("리더는 이름·설명을 고친다", aDescR.data?.length === 1, `(${aDescR.error?.code ?? aDescR.data?.length})`);
  const cTakes = await C.sb.rpc("transfer_leader", { p_channel: r, p_user: C.id });
  check("리더가 아니면 리더를 못 넘긴다", cTakes.error?.code === "42501", `(${cTakes.error?.code ?? "ok"})`);
  const hand = await A.sb.rpc("transfer_leader", { p_channel: r, p_user: C.id });
  check(
    "리더를 넘기면 받은 사람이 리더, 원래 리더는 부리더 (한도를 넘어도)",
    !hand.error && (await roleOf(r, C.id)) === "leader" && (await roleOf(r, A.id)) === "sub" && (await roleOf(r, B.id)) === "sub",
    `(${hand.error?.message ?? "ok"})`,
  );
  const cKicksB = await kickBy(C, r, B.id);
  check("새 리더는 부리더를 내보낸다", cKicksB.data?.length === 1, `(${cKicksB.error?.code ?? cKicksB.data?.length})`);
  await invite(C, r, B.id);
  const reSub = await sub(C, r, B.id, true);
  check("부리더가 찼으면(넘긴 뒤 A 1명) 더 못 정한다", reSub.error?.code === "23514", `(${reSub.error?.code ?? "ok"})`);
  const cLeaves = await C.sb.from("memberships").delete().eq("channel_id", r).eq("user_id", C.id).select();
  check("리더가 나가면 부리더가 리더가 된다", cLeaves.data?.length === 1 && (await roleOf(r, A.id)) === "leader");
  const aLeaves = await A.sb.from("memberships").delete().eq("channel_id", r).eq("user_id", A.id).select();
  check("부리더가 없으면 남은 멤버 중 먼저 들어온 사람이 리더", aLeaves.data?.length === 1 && (await roleOf(r, B.id)) === "leader");
  await B.sb.from("memberships").delete().eq("channel_id", r).eq("user_id", B.id);
  const refill = await invite(M, r, A.id);
  check("비어 있던 채널에 처음 들어온 사람이 리더가 된다", refill.data?.length === 1 && (await roleOf(r, A.id)) === "leader", `(${refill.error?.code ?? "ok"})`);
  const { data: roleLogs } = await admin.from("admin_logs").select("actor_id, action, target").eq("target->>channel_id", r);
  check(
    "부리더 지정·리더 넘기기·자동 위임이 admin_logs 에 남는다",
    ["grant_sub", "transfer_leader"].every((a) => roleLogs?.some((l) => l.action === a && l.actor_id)) &&
      (roleLogs?.filter((l) => l.action === "auto_leader" && l.actor_id === null).length ?? 0) === 3,
    `(${roleLogs?.map((l) => l.action).join(",")})`,
  );
  const genRight = await C.sb.rpc("has_invite_right", { p_channel: GENERAL });
  const genAdd = await invite(C, GENERAL, M.id);
  check("부서 채널(#일반)은 관리자만 초대한다", genRight.data === false && !!genAdd.error, `(${genAdd.error?.code})`);
  const genRole = await roleOf(GENERAL, C.id);
  check("부서 채널에는 리더가 없다", genRole === "member", `(${genRole})`);

  // ── 실시간 (구독을 먼저 연다) ──
  const rtB = await listen(B.sb, "B");
  const rtC = await listen(C.sb, "C");
  const rtAnon = await listen(anon, "anon");
  await wait(500);

  // ── 메시지 읽기·쓰기 ──
  const m1 = await send(A.sb, X.data.id, `검사 메시지 ${run}`);
  check("멤버는 메시지를 쓴다", m1.data?.length === 1, `(${m1.error?.code ?? "ok"})`);
  const bRead = await B.sb.from("messages").select("id").eq("channel_id", X.data.id);
  check("다른 멤버는 읽는다", bRead.data?.length === 1);
  const cRead = await C.sb.from("messages").select("id").eq("channel_id", X.data.id);
  check("비회원 C 가 조회하면 0건", cRead.data?.length === 0, `(${cRead.data?.length}건)`);
  const cWrite = await send(C.sb, X.data.id, "C 가 끼어들기");
  check("비회원 C 가 쓰면 거부", !!cWrite.error, `(${cWrite.error?.code})`);
  const forged = await send(A.sb, X.data.id, "B 인 척", randomUUID(), { user_id: B.id });
  check("다른 사람 user_id 로 쓰면 거부", !!forged.error, `(${forged.error?.code})`);
  const blank = await send(A.sb, X.data.id, "  \n ");
  check("빈 메시지 거부", !!blank.error, `(${blank.error?.code})`);
  const dupId = randomUUID();
  const d1 = await send(A.sb, X.data.id, "중복 검사", dupId);
  const d2 = await send(A.sb, X.data.id, "중복 검사", dupId);
  const { count: dupCount } = await admin.from("messages").select("*", { count: "exact", head: true }).eq("client_id", dupId);
  check("같은 client_id 는 한 번만 저장", d1.data?.length === 1 && d2.data?.length === 0 && dupCount === 1, `(${dupCount}건)`);
  const reply = await send(B.sb, X.data.id, "답글", randomUUID(), { parent_id: m1.data[0].id });
  check("같은 채널 메시지에 답글", !reply.error, `(${reply.error?.code ?? "ok"})`);
  const badReply = await send(A.sb, P.data.id, "다른 채널에 답글", randomUUID(), { parent_id: m1.data[0].id });
  check("다른 채널 메시지에 답글 거부", !!badReply.error, `(${badReply.error?.code})`);
  const cEdit = await C.sb.from("messages").update({ body: "고침" }).eq("id", m1.data[0].id).select();
  const bEdit = await B.sb.from("messages").update({ body: "고침" }).eq("id", m1.data[0].id).select();
  check("남의 메시지는 못 고친다", cEdit.data?.length === 0 && bEdit.data?.length === 0);

  await wait(2500);
  const mine = (list) => list.filter((m) => m.channel_id === X.data.id);
  check("멤버 B 는 실시간으로 받는다", mine(rtB).length >= 1, `(${mine(rtB).length}건)`);
  check("비회원 C 는 실시간으로도 못 받는다", mine(rtC).length === 0, `(${mine(rtC).length}건)`);
  check("익명(Step 1)은 다른 채널 이벤트를 못 받는다", mine(rtAnon).length === 0, `(${mine(rtAnon).length}건)`);

  // ── 읽음 위치 ──
  const rp = await B.sb.rpc("mark_read", { p_channel_id: X.data.id, p_message_id: m1.data[0].id });
  const back = await B.sb.rpc("mark_read", { p_channel_id: X.data.id, p_message_id: 1 });
  check("읽음 위치는 mark_read 로 쓰고 뒤로 가지 않는다", !rp.error && Number(back.data) === m1.data[0].id, `(${rp.error?.code ?? back.data})`);
  const cMark = await C.sb.rpc("mark_read", { p_channel_id: X.data.id, p_message_id: m1.data[0].id });
  check("비회원은 읽음 위치를 못 쓴다", !!cMark.error, `(${cMark.error?.code})`);
  const aSeesB = await A.sb.from("read_positions").select("user_id").eq("channel_id", X.data.id);
  const cSeesB = await C.sb.from("read_positions").select("user_id").eq("channel_id", X.data.id);
  check("같은 채널 멤버는 읽음 위치를 본다, C 는 못 본다", aSeesB.data?.length === 1 && cSeesB.data?.length === 0);
  const fakeNoti = await A.sb.from("notifications").insert({ user_id: B.id, type: "dm" }).select();
  check("알림은 클라이언트가 못 만든다", !!fakeNoti.error, `(${fakeNoti.error?.code})`);

  // ── DM ──
  const dm1 = await A.sb.rpc("create_dm", { other_user_id: B.id });
  const dm2 = await A.sb.rpc("create_dm", { other_user_id: B.id });
  const dm3 = await B.sb.rpc("create_dm", { other_user_id: A.id });
  if (dm1.data) made.channels.push(dm1.data);
  check("create_dm 을 여러 번 불러도 채널 하나", !!dm1.data && dm1.data === dm2.data && dm1.data === dm3.data, `(${dm1.error?.message ?? "ok"})`);
  await send(A.sb, dm1.data, "DM 검사");
  const cDm = await C.sb.from("messages").select("id").eq("channel_id", dm1.data);
  const cDmCh = await C.sb.from("channels").select("id").eq("id", dm1.data);
  check("A→B DM 을 C 가 조회하면 0건", cDm.data?.length === 0 && cDmCh.data?.length === 0);
  const mDm = await M.sb.from("messages").select("id").eq("channel_id", dm1.data);
  check("관리자도 남의 DM 은 못 본다", mDm.data?.length === 0);
  const dmRole = await A.sb.rpc("set_sub_leader", { p_channel: dm1.data, p_user: B.id, p_on: true });
  const dmAdd = await A.sb.from("memberships").insert({ channel_id: dm1.data, user_id: C.id }).select();
  check("DM 에는 리더·부리더도 초대도 없다", !!dmRole.error && !!dmAdd.error, `(${dmRole.error?.code}·${dmAdd.error?.code})`);

  // ── 관리자·멤버 제거 ──
  const bKicksA = await B.sb.from("memberships").delete().eq("channel_id", X.data.id).eq("user_id", A.id).select();
  check("일반 사용자가 남을 빼면 거부 (0건)", (bKicksA.data ?? []).length === 0, `(${bKicksA.error?.code ?? `${bKicksA.data?.length}건`})`);
  const rtB2 = rtB.length;
  const kick = await M.sb.from("memberships").delete().eq("channel_id", X.data.id).eq("user_id", B.id).select();
  check("관리자는 멤버를 뺀다", kick.data?.length === 1, `(${kick.error?.code ?? `${kick.data?.length}건`})`);
  const { data: logs } = await M.sb.from("admin_logs").select("action, target").eq("actor_id", M.id);
  check("멤버 제거가 admin_logs 에 남는다", logs?.some((l) => l.action === "remove_member" && l.target.user_id === B.id));
  const aLogs = await A.sb.from("admin_logs").select("id");
  check("관리 기록은 관리자만 본다", aLogs.data?.length === 0);
  await send(A.sb, X.data.id, "B 가 빠진 뒤");
  await wait(2500);
  const afterKick = rtB.slice(rtB2).filter((m) => m.channel_id === X.data.id).length;
  check("빠진 멤버는 열려 있던 구독으로도 새 메시지를 못 받는다", afterKick === 0, `(${afterKick}건)`);

  // ── 회의실·회의 ──
  const roomByA = await A.sb.from("rooms").insert({ name: `검사실A-${run}` }).select();
  check("일반 사용자는 회의실을 못 만든다", !!roomByA.error || roomByA.data?.length === 0, `(${roomByA.error?.code})`);
  const room = await M.sb.from("rooms").insert({ name: `검사실-${run}`, capacity: 6 }).select().single();
  if (room.error) throw room.error;
  made.rooms.push(room.data.id);
  const ev = (who, start, end, attendees = [], roomId = room.data.id) =>
    who.sb.rpc("create_event", { p_title: `검사 회의 ${run}`, p_starts_at: start, p_ends_at: end, p_room_id: roomId, p_attendee_ids: attendees });
  const T = (h, m = 0) => `2030-01-07T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`;
  const e1 = await ev(B, T(10), T(11), [A.id]);
  if (e1.data) made.events.push(e1.data);
  const e2 = await ev(A, T(10, 30), T(11, 30));
  if (e2.data) made.events.push(e2.data);
  const e3 = await ev(A, T(11), T(12));
  if (e3.data) made.events.push(e3.data);
  check("겹치는 시간에 같은 회의실은 거부 (23P01)", !!e1.data && e2.error?.code === "23P01", `(${e1.error?.message ?? e2.error?.code})`);
  check("10:00~11:00 뒤 11:00~12:00 은 들어간다", !!e3.data, `(${e3.error?.message ?? "ok"})`);
  const [r1, r2] = await Promise.all([ev(A, T(14), T(15)), ev(B, T(14, 30), T(15, 30))]);
  for (const r of [r1, r2]) if (r.data) made.events.push(r.data);
  check("동시에 넣어도 하나만 성공", [r1, r2].filter((r) => r.data).length === 1, `(${[r1, r2].map((r) => r.error?.code ?? "ok")})`);

  const aEvents = await A.sb.from("events").select("id, title").eq("id", e1.data);
  const cEvents = await C.sb.from("events").select("id").in("id", made.events);
  const cAtt = await C.sb.from("event_attendees").select("event_id").in("event_id", made.events);
  check("초대받은 A 는 회의를 본다 (정책 재귀 없음)", aEvents.data?.length === 1, `(${aEvents.error?.message ?? "ok"})`);
  check("참석자가 아닌 C 가 events 를 조회하면 0건", cEvents.data?.length === 0 && cAtt.data?.length === 0);
  const busy = await C.sb.rpc("room_busy", { p_room_id: room.data.id, p_from: T(0), p_to: T(23) });
  const busyKeys = Object.keys(busy.data?.[0] ?? {}).sort().join(",");
  check("room_busy 는 시간대만 준다", busy.data?.length === 3 && busyKeys === "ends_at,starts_at", `(${busy.data?.length}건, ${busyKeys})`);
  const aEdit = await A.sb.from("events").update({ title: "A 가 고침" }).eq("id", e1.data).select();
  check("만든 사람이 아니면 회의를 못 고친다", aEdit.data?.length === 0);
  const aAccept = await A.sb.from("event_attendees").update({ response: "accepted" }).eq("event_id", e1.data).eq("user_id", A.id).select();
  check("초대받은 사람은 응답을 고친다", aAccept.data?.[0]?.response === "accepted" && !!aAccept.data[0].responded_at);
  const cancel = await B.sb.from("events").update({ canceled_at: new Date().toISOString() }).eq("id", e1.data).select();
  const e4 = await ev(A, T(10), T(10, 30));
  if (e4.data) made.events.push(e4.data);
  check("취소한 회의 시간에 새 회의를 잡을 수 있다", cancel.data?.length === 1 && !!e4.data, `(${e4.error?.code ?? "ok"})`);

  // ── Step 1 임시 호환 (익명) ──
  const anonRead = await anon.from("messages").select("channel_id");
  check("익명은 #일반 만 읽는다", (anonRead.data ?? []).every((m) => m.channel_id === GENERAL), `(${anonRead.data?.length}건)`);
  const anonToX = await anon.from("messages").insert({ client_id: randomUUID(), author: "익명", body: "X 로", channel_id: X.data.id });
  check("익명은 다른 채널에 못 쓴다", !!anonToX.error, `(${anonToX.error?.code})`);
  const anonAsUser = await anon.from("messages").insert({ client_id: randomUUID(), author: "익명", body: "A 인 척", user_id: A.id });
  check("익명은 user_id 를 못 넣는다", !!anonAsUser.error, `(${anonAsUser.error?.code})`);
  const anonCh = await anon.from("channels").select("id");
  check("익명은 채널 목록을 못 본다", !!anonCh.error || anonCh.data?.length === 0, `(${anonCh.error?.code ?? anonCh.data?.length})`);

  // ── 첨부 버킷 ──
  const { data: bucket } = await admin.storage.getBucket("attachments");
  check("첨부 버킷은 비공개, 5MB·PNG·JPEG·PDF", bucket?.public === false && bucket?.file_size_limit === 5242880 && bucket?.allowed_mime_types?.length === 3);
} catch (e) {
  results.push(`FAIL  검사 오류: ${e.message ?? e}`);
} finally {
  for (const { sb, channel } of made.realtime) await sb.removeChannel(channel);
  const steps = [
    admin.from("events").delete().in("id", made.events),
    admin.from("rooms").delete().in("id", made.rooms),
    admin.from("channels").delete().in("id", made.channels),
    admin.from("admin_logs").delete().in("actor_id", made.users),
    // 리더 자동 위임 기록은 작성자가 없다 → 검사 채널 것으로 지운다
    admin.from("admin_logs").delete().is("actor_id", null).in("target->>channel_id", made.channels),
  ];
  const errors = (await Promise.all(steps)).map((r) => r.error?.message).filter(Boolean);
  for (const id of made.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(error.message);
  }
  console.log(errors.length ? `정리 실패: ${errors.join(" / ")}` : `정리: 사용자 ${made.users.length}명, 채널 ${made.channels.length}개, 회의 ${made.events.length}개, 회의실 ${made.rooms.length}개`);
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
