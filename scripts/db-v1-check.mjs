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
  const roleUp = await A.sb.from("profiles").update({ role: "admin" }).eq("id", A.id).select();
  check("본인 role 을 admin 으로 못 바꾼다", !!roleUp.error, `(${roleUp.error?.code})`);
  const nameUp = await A.sb.from("profiles").update({ display_name: "검사A2" }).eq("id", A.id).select();
  check("본인 이름은 고칠 수 있다", nameUp.data?.length === 1, `(${nameUp.error?.code ?? "ok"})`);

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
  const addC = await B.sb.from("memberships").insert({ channel_id: X.data.id, user_id: C.id }).select();
  check("일반 사용자는 남을 채널에 못 넣는다", !!addC.error, `(${addC.error?.code})`);
  const pVisibleToC = await C.sb.from("channels").select("id").eq("id", P.data.id);
  check("비공개 채널은 멤버가 아니면 안 보인다", pVisibleToC.data?.length === 0);

  // ── 초대 권한 (20260929150000_invite_rights.sql) ──
  const invite = (u, channel, userId) => u.sb.from("memberships").insert({ channel_id: channel, user_id: userId }).select();
  const setRight = (u, channel, userId, value) =>
    u.sb.from("memberships").update({ can_invite: value }).eq("channel_id", channel).eq("user_id", userId).select("user_id");
  const rightOf = async (channel, userId) =>
    (await admin.from("memberships").select("can_invite").eq("channel_id", channel).eq("user_id", userId).single()).data?.can_invite;
  check("채널을 만든 사람은 초대 권한을 갖는다", (await rightOf(P.data.id, A.id)) === true);
  const aAddsB = await invite(A, P.data.id, B.id);
  check("만든 사람은 비공개 채널에 남을 넣는다", aAddsB.data?.length === 1, `(${aAddsB.error?.code ?? "ok"})`);
  check("초대받은 사람은 초대 권한이 없다", (await rightOf(P.data.id, B.id)) === false);
  const bAddsC = await invite(B, P.data.id, C.id);
  check("초대 권한이 없는 멤버는 남을 못 넣는다", !!bAddsC.error, `(${bAddsC.error?.code})`);
  const bSelf = await setRight(B, P.data.id, B.id, true);
  check("초대 권한은 스스로 못 가진다 (0건)", (bSelf.data ?? []).length === 0 && (await rightOf(P.data.id, B.id)) === false, `(${bSelf.error?.code ?? `${bSelf.data?.length}건`})`);
  const withRight = await A.sb.from("memberships").insert({ channel_id: P.data.id, user_id: C.id, can_invite: true }).select();
  check("넣으면서 초대 권한을 같이 줄 수는 없다", !!withRight.error, `(${withRight.error?.code})`);
  const aGrantsB = await setRight(A, P.data.id, B.id, true);
  check("권한 있는 사람은 다른 멤버에게 초대 권한을 준다", aGrantsB.data?.length === 1 && (await rightOf(P.data.id, B.id)) === true, `(${aGrantsB.error?.code ?? "ok"})`);
  const bAddsC2 = await invite(B, P.data.id, C.id);
  check("권한을 받은 멤버는 남을 넣는다", bAddsC2.data?.length === 1, `(${bAddsC2.error?.code ?? "ok"})`);
  const cGrantsC = await setRight(C, P.data.id, C.id, true);
  check("권한 없는 C 는 스스로 권한을 못 준다 (0건)", (cGrantsC.data ?? []).length === 0 && (await rightOf(P.data.id, C.id)) === false);
  const bRevokesA = await setRight(B, P.data.id, A.id, false);
  check("관리자가 아니면 초대 권한을 못 뺀다", (!!bRevokesA.error || (bRevokesA.data ?? []).length === 0) && (await rightOf(P.data.id, A.id)) === true, `(${bRevokesA.error?.code ?? `${bRevokesA.data?.length}건`})`);
  const bKicksC = await B.sb.from("memberships").delete().eq("channel_id", P.data.id).eq("user_id", C.id).select();
  check("초대 권한이 있어도 내보내기는 못 한다 (0건)", (bKicksC.data ?? []).length === 0, `(${bKicksC.error?.code ?? `${bKicksC.data?.length}건`})`);
  const mRevokesB = await setRight(M, P.data.id, B.id, false);
  check("관리자는 초대 권한을 뺀다", mRevokesB.data?.length === 1 && (await rightOf(P.data.id, B.id)) === false, `(${mRevokesB.error?.code ?? "ok"})`);
  const { data: rightLogs } = await admin.from("admin_logs").select("actor_id, action, target").in("actor_id", [A.id, M.id]);
  check(
    "초대·권한 주기·빼기가 admin_logs 에 남는다",
    ["add_member", "grant_invite"].every((a) => rightLogs?.some((l) => l.actor_id === A.id && l.action === a && l.target.channel_id === P.data.id)) &&
      rightLogs?.some((l) => l.actor_id === M.id && l.action === "revoke_invite" && l.target.user_id === B.id),
  );

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
  const dmRight = await A.sb.from("memberships").update({ can_invite: true }).eq("channel_id", dm1.data).eq("user_id", A.id).select("user_id");
  const dmAdd = await A.sb.from("memberships").insert({ channel_id: dm1.data, user_id: C.id }).select();
  check("DM 에는 초대 권한도 초대도 없다", (dmRight.data ?? []).length === 0 && !!dmAdd.error, `(${dmAdd.error?.code})`);

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
