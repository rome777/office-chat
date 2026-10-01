// 메시지 알림 트리거·권한 자동 확인 (알림 작업, 원격 Supabase).
// 실행: npm run check:notify
// 모두·부서 멘션은 임시 부서(본부→팀)를 만들어 확인한다. 가상 사용자 A·B·C·D 를 만들고(비밀번호 없이 일회용 로그인 토큰), 끝나면 사용자·채널을 모두 지운다.
// A·B·D 는 채널 X 멤버, C 는 아니다. A·B 는 DM 도 한다.
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
const made = { users: [], channels: [], realtime: [], units: [] };
const GENERAL = "00000000-0000-0000-0000-000000000001";

async function makeUser(tag) {
  const email = `notify-check-${run}-${tag.toLowerCase()}@example.com`;
  const handle = `nt${tag}${run}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { handle, display_name: `알림${tag}` },
  });
  if (error) throw error;
  made.users.push(data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const sb = createClient(url, anonKey, noSession);
  const { data: s, error: e2 } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (e2) throw e2;
  await sb.realtime.setAuth(s.session.access_token);
  return { id: data.user.id, handle, sb };
}

const send = async (u, channel_id, body, extra = {}, client_id = randomUUID()) => {
  const { data, error } = await u.sb
    .from("messages")
    .upsert({ client_id, channel_id, body, ...extra }, { onConflict: "client_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`${body}: ${error.message}`);
  return { id: data[0]?.id, client_id };
};

/** 서버에서 본 그 메시지의 알림 (user_id → type) */
async function notesFor(messageId) {
  const { data } = await admin.from("notifications").select("user_id, type").eq("message_id", messageId);
  return Object.fromEntries((data ?? []).map((n) => [n.user_id, n.type]));
}

try {
  const A = await makeUser("A");
  const B = await makeUser("B");
  const C = await makeUser("C");
  const D = await makeUser("D");
  const X = await A.sb.from("channels").insert({ name: `알림검사-${run}`, type: "public" }).select().single();
  if (X.error) throw X.error;
  made.channels.push(X.data.id);
  for (const u of [B, D]) await u.sb.from("memberships").insert({ channel_id: X.data.id, user_id: u.id });

  // 실시간: B 와 C 가 각자 자기 알림을 구독한다
  const listen = async (u, label) => {
    const got = [];
    const ch = u.sb
      .channel(`notify-check-${label}-${randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${u.id}` }, (p) => got.push(p.new));
    await new Promise((res, rej) => ch.subscribe((s, err) => (s === "SUBSCRIBED" ? res() : s !== "CLOSED" && rej(err ?? new Error(s)))));
    made.realtime.push({ sb: u.sb, channel: ch });
    return got;
  };
  const rtB = await listen(B, "B");
  const rtC = await listen(C, "C");
  await wait(500);

  // ── 멘션 ──
  const m1 = await send(A, X.data.id, `@${B.handle} 확인 부탁해요 @${B.handle.toUpperCase()}`);
  let n = await notesFor(m1.id);
  check("@B 를 부르면 B 에게 mention 하나", n[B.id] === "mention" && Object.keys(n).length === 1, `(${JSON.stringify(Object.values(n))})`);
  await send(A, X.data.id, `@${B.handle} 확인 부탁해요`, {}, m1.client_id); // 같은 client_id 로 다시 보내기
  const { count: again } = await admin.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", B.id).eq("message_id", m1.id);
  check("다시 보내도 알림은 한 번만", again === 1, `(${again}건)`);
  const m2 = await send(A, X.data.id, `@${C.handle} 여기 없죠?`);
  n = await notesFor(m2.id);
  check("채널 멤버가 아닌 사람을 멘션하면 알림이 없다", Object.keys(n).length === 0, `(${JSON.stringify(n)})`);
  const m3 = await send(A, X.data.id, `메일은 x${B.handle}@example.com 으로`);
  check("메일 주소는 멘션이 아니다", Object.keys(await notesFor(m3.id)).length === 0);
  const m4 = await send(A, X.data.id, `@${A.handle} 나를 불러 봄`);
  check("보낸 사람 자신은 알림을 받지 않는다", Object.keys(await notesFor(m4.id)).length === 0);

  // ── 스레드 답글 ──
  const parent = await send(B, X.data.id, "B 가 올린 질문");
  const r1 = await send(D, X.data.id, "D 의 답글", { parent_id: parent.id });
  n = await notesFor(r1.id);
  check("답글이 달리면 부모 작성자에게 thread_reply", n[B.id] === "thread_reply" && !n[D.id], `(${JSON.stringify(n)})`);
  const r2 = await send(A, X.data.id, `@${D.handle} 이것도 봐 주세요`, { parent_id: parent.id });
  n = await notesFor(r2.id);
  check("스레드에 이미 답한 사람과 부모 작성자에게 간다 (멘션이 먼저)", n[D.id] === "mention" && n[B.id] === "thread_reply" && !n[A.id], `(${JSON.stringify(n)})`);

  // ── DM ──
  const dm = await A.sb.rpc("create_dm", { other_user_id: B.id });
  if (dm.error) throw dm.error;
  made.channels.push(dm.data);
  const d1 = await send(A, dm.data, "DM 입니다");
  n = await notesFor(d1.id);
  check("DM 을 보내면 상대에게 dm 알림", n[B.id] === "dm" && Object.keys(n).length === 1, `(${JSON.stringify(n)})`);
  const d2 = await send(A, dm.data, `@${B.handle} DM 안에서 멘션`);
  n = await notesFor(d2.id);
  check("DM 안의 멘션은 mention 하나만 (dm 과 겹치지 않음)", n[B.id] === "mention" && Object.keys(n).length === 1, `(${JSON.stringify(n)})`);

  // ── 익명(Step 1) — 2026-10-01 익명 쓰기를 닫아 메시지 자체가 들어가지 않는다 ──
  const anon = createClient(url, anonKey, noSession);
  const { data: an, error: anErr } = await anon.from("messages").insert({ client_id: randomUUID(), body: `@${B.handle} 익명이 부름` }).select("id");
  check("익명은 메시지를 못 써서 알림도 없다", !!anErr && !an?.length, `(${anErr?.code})`);
  if (an?.[0]?.id) await admin.from("messages").delete().eq("id", an[0].id);

  // ── 실시간·권한 ──
  await wait(2500);
  const bGot = rtB.map((x) => x.type).sort().join(",");
  check("B 는 자기 알림을 실시간으로 받는다", rtB.length === 5, `(${rtB.length}건: ${bGot})`);
  check("C 는 남의 알림을 실시간으로 받지 않는다", rtC.length === 0, `(${rtC.length}건)`);
  const cSees = await C.sb.from("notifications").select("id").eq("user_id", B.id);
  check("C 는 B 의 알림을 조회하지 못한다", cSees.data?.length === 0);
  const fake = await A.sb.from("notifications").insert({ user_id: B.id, type: "dm", channel_id: X.data.id, message_id: m1.id }).select();
  check("알림은 클라이언트가 못 만든다", !!fake.error, `(${fake.error?.code})`);
  const bNotes = await B.sb.from("notifications").select("id").eq("user_id", B.id);
  const mark = await B.sb.from("notifications").update({ read_at: new Date().toISOString() }).in("id", bNotes.data.map((x) => x.id)).select("id");
  const aMark = await A.sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", B.id).select("id");
  check("본인만 읽음 표시한다", mark.data?.length === bNotes.data.length && aMark.data?.length === 0, `(본인 ${mark.data?.length}, 남 ${aMark.data?.length})`);
  const bTypeChange = await B.sb.from("notifications").update({ type: "mention" }).eq("user_id", B.id).select("id");
  check("알림 종류는 못 바꾼다 (read_at 만)", !!bTypeChange.error, `(${bTypeChange.error?.code})`);

  // ── 모두·부서 멘션 (20260930090000) — 임시 부서: 본부 P → 팀 T. B·C 는 T, D 는 P 소속. C 는 채널 X 멤버가 아니다 ──
  const { data: company } = await admin.from("org_units").select("id").eq("kind", "company").single();
  const P = await admin.from("org_units").insert({ name: `알림검사본부-${run}`, kind: "hq", parent_id: company.id }).select("id, channel_id").single();
  if (P.error) throw P.error;
  made.units.unshift(P.data.id);
  made.channels.push(P.data.channel_id);
  const T = await admin.from("org_units").insert({ name: `알림검사팀-${run}`, kind: "team", parent_id: P.data.id }).select("id, channel_id").single();
  if (T.error) throw T.error;
  made.units.unshift(T.data.id); // 지울 때 팀부터
  made.channels.push(T.data.channel_id);
  for (const [u, unit] of [[B, T], [C, T], [D, P]]) {
    const { error } = await admin.from("profiles").update({ org_unit_id: unit.data.id }).eq("id", u.id);
    if (error) throw error;
  }
  const g1 = await send(A, X.data.id, "@all-members-in-channel 모두 보세요");
  n = await notesFor(g1.id);
  check("@모두 는 이 채널 멤버 전체(보낸 사람·채널 밖 사람 빼고)에게 mention", n[B.id] === "mention" && n[D.id] === "mention" && !n[A.id] && !n[C.id], `(${JSON.stringify(n)})`);
  const g2 = await send(A, X.data.id, `@org-${P.data.id} 본부 공지`);
  n = await notesFor(g2.id);
  check("@부서 는 그 부서와 하위 부서 소속 가운데 이 채널 멤버에게만", n[B.id] === "mention" && n[D.id] === "mention" && !n[C.id] && Object.keys(n).length === 2, `(${JSON.stringify(n)})`);
  const g3 = await send(A, X.data.id, `@org-${T.data.id} 팀만`);
  n = await notesFor(g3.id);
  check("하위 부서를 부르면 상위 부서 사람은 받지 않는다", n[B.id] === "mention" && Object.keys(n).length === 1, `(${JSON.stringify(n)})`);
  const g4 = await send(A, X.data.id, `@all-members-in-channel @org-${P.data.id} @${B.handle} 겹침`);
  const { count: dup } = await admin.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", B.id).eq("message_id", g4.id);
  check("사람·모두·부서로 여러 번 불려도 알림은 하나", dup === 1, `(${dup}건)`);
  const g5 = await send(A, X.data.id, `메일 x@org-${P.data.id} 모양`);
  check("앞이 글자인 @org- 는 멘션이 아니다", Object.keys(await notesFor(g5.id)).length === 0);
} catch (e) {
  results.push(`FAIL  검사 오류: ${e.message ?? e}`);
} finally {
  for (const { sb, channel } of made.realtime) await sb.removeChannel(channel);
  const errors = [];
  for (const id of made.units) {
    // 부서 채널은 부서가 가리키므로(restrict) 부서를 먼저 지운다. 소속은 사용자를 지울 때 사라지지만, 먼저 비운다
    await admin.from("profiles").update({ org_unit_id: null }).eq("org_unit_id", id);
    const { error } = await admin.from("org_units").delete().eq("id", id);
    if (error) errors.push(error.message);
  }
  if (made.channels.length) {
    const { error } = await admin.from("channels").delete().in("id", made.channels);
    if (error) errors.push(error.message);
  }
  for (const id of made.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(error.message);
  }
  console.log(errors.length ? `정리 실패: ${errors.join(" / ")}` : `정리: 사용자 ${made.users.length}명, 채널 ${made.channels.length}개, 부서 ${made.units.length}개`);
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
