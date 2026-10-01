// 일정 알림 트리거·10분 전 알림·불참 알림 자동 확인 (일정 알림 작업, 원격 Supabase).
// 실행: npm run check:events   (pg_cron 이 실제로 도는지 보려고 최대 90초 기다린다)
// 가상 사용자 A(만든 사람)·B·C(참석자)와 회의실 하나를 만들고, 끝나면 모두 지운다.
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
const made = { users: [], events: [], rooms: [] };
const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();

async function makeUser(tag) {
  const email = `event-check-${run}-${tag.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { handle: `ev${tag}${run}`, display_name: `일정${tag}` } });
  if (error) throw error;
  made.users.push(data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const sb = createClient(url, anonKey, noSession);
  const { error: e2 } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (e2) throw e2;
  return { id: data.user.id, sb };
}

/** 그 회의의 알림을 "사람:종류" 목록으로 */
async function notes(eventId) {
  const { data } = await admin.from("notifications").select("user_id, type").eq("event_id", eventId).order("id");
  return data ?? [];
}
/** 그 회의에서 user(만든 사람)가 받은 불참 알림 */
async function declines(eventId, user) {
  const { data } = await admin.from("notifications").select("id, actor_id, read_at").eq("event_id", eventId).eq("user_id", user.id).eq("type", "event_decline").order("id");
  return data ?? [];
}
const has = (list, user, type) => list.some((n) => n.user_id === user.id && n.type === type);
const count = (list, user, type) => list.filter((n) => n.user_id === user.id && n.type === type).length;

try {
  const A = await makeUser("A");
  const B = await makeUser("B");
  const C = await makeUser("C");

  // ── 초대 ── (회의실 없이: 분 단위 시각으로 알림을 시험하는데 회의실 예약은 30분 단위만 된다 — 2026-10-01 회의실 정책)
  const ev = await A.sb.rpc("create_event", { p_title: `일정 검사 ${run}`, p_starts_at: inMin(60), p_ends_at: inMin(90), p_attendee_ids: [B.id] });
  if (ev.error) throw ev.error;
  made.events.push(ev.data);
  let n = await notes(ev.data);
  check("초대받으면 알림이 생긴다", has(n, B, "event_invite"), `(${n.length}건)`);
  check("만든 사람 자신에게는 초대 알림이 없다", !has(n, A, "event_invite"));
  const addC = await A.sb.from("event_attendees").insert({ event_id: ev.data, user_id: C.id });
  n = await notes(ev.data);
  check("나중에 추가한 참석자도 초대 알림", !addC.error && has(n, C, "event_invite"), `(${addC.error?.message ?? "ok"})`);
  await C.sb.from("event_attendees").update({ response: "declined" }).eq("event_id", ev.data).eq("user_id", C.id);

  // ── 불참 (만든 사람에게 알림, 20260929190000) ──
  const respondC = (response) => C.sb.from("event_attendees").update({ response }).eq("event_id", ev.data).eq("user_id", C.id);
  let dec = await declines(ev.data, A);
  n = await notes(ev.data);
  check("불참하면 만든 사람에게 불참 알림 (누가 불참했는지 함께)", dec.length === 1 && dec[0].actor_id === C.id, `(${dec.length}건)`);
  check("불참 알림은 만든 사람만 받는다", !has(n, B, "event_decline") && !has(n, C, "event_decline"));
  await respondC("accepted");
  dec = await declines(ev.data, A);
  check("다시 참석하면 안 읽은 불참 알림을 지운다", dec.length === 0, `(${dec.length}건)`);
  await respondC("declined");
  dec = await declines(ev.data, A);
  await A.sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", dec[0]?.id);
  await respondC("accepted");
  dec = await declines(ev.data, A);
  check("읽은 불참 알림은 다시 참석해도 남는다", dec.length === 1 && dec[0].read_at !== null, `(${dec.length}건)`);
  await respondC("declined"); // 아래 검사는 C 가 불참한 상태를 쓴다
  dec = await declines(ev.data, A);
  check("다시 불참하면 새 불참 알림 (읽은 것과 따로)", dec.length === 2 && dec.filter((d) => d.read_at === null).length === 1, `(${dec.length}건)`);

  // ── 변경 ──
  await A.sb.from("events").update({ title: `일정 검사 ${run} (제목 바꿈)` }).eq("id", ev.data);
  n = await notes(ev.data);
  check("제목이 바뀌면 거절하지 않은 참석자에게 변경 알림", has(n, B, "event_update") && !has(n, C, "event_update") && !has(n, A, "event_update"), `(B ${has(n, B, "event_update")}, C ${has(n, C, "event_update")}, A ${has(n, A, "event_update")})`);
  await A.sb.from("events").update({ description: "설명만 바꿈" }).eq("id", ev.data);
  check("설명만 바꾸면 알림이 없다", count(await notes(ev.data), B, "event_update") === 1);

  // ── 10분 전 ──
  let sent = await admin.rpc("send_event_reminders");
  n = await notes(ev.data);
  check("시작 10분 전이 아니면 10분 전 알림이 없다", !has(n, B, "event_reminder"), `(${sent.error?.message ?? `새 알림 ${sent.data}`})`);
  await A.sb.from("events").update({ starts_at: inMin(5), ends_at: inMin(35) }).eq("id", ev.data);
  n = await notes(ev.data);
  check("시각이 바뀌면 변경 알림", count(n, B, "event_update") === 2);
  await admin.rpc("send_event_reminders");
  await admin.rpc("send_event_reminders");
  n = await notes(ev.data);
  check("10분 안에 시작하면 참석자·만든 사람에게 10분 전 알림 (여러 번 돌아도 한 번)", count(n, A, "event_reminder") === 1 && count(n, B, "event_reminder") === 1, `(A ${count(n, A, "event_reminder")}, B ${count(n, B, "event_reminder")})`);
  check("거절한 사람은 10분 전 알림을 받지 않는다", !has(n, C, "event_reminder"));
  await A.sb.from("events").update({ starts_at: inMin(8), ends_at: inMin(38) }).eq("id", ev.data);
  n = await notes(ev.data);
  check("시작 시각을 바꾸면 10분 전 알림을 지운다", !has(n, B, "event_reminder"));
  await admin.rpc("send_event_reminders");
  n = await notes(ev.data);
  check("새 시각 기준으로 10분 전 알림이 다시 온다", count(n, B, "event_reminder") === 1);

  // ── 취소 ──
  await A.sb.from("events").update({ canceled_at: new Date().toISOString() }).eq("id", ev.data);
  n = await notes(ev.data);
  check("취소하면 거절하지 않은 참석자에게 취소 알림", has(n, B, "event_cancel") && !has(n, C, "event_cancel") && !has(n, A, "event_cancel"));
  await B.sb.from("event_attendees").update({ response: "declined" }).eq("event_id", ev.data).eq("user_id", B.id);
  check("취소된 회의에서 불참해도 불참 알림이 없다", !(await declines(ev.data, A)).some((d) => d.actor_id === B.id));
  const canceled = await admin.from("events").insert({ title: `취소된 회의 ${run}`, starts_at: inMin(4), ends_at: inMin(20), created_by: A.id, canceled_at: new Date().toISOString() }).select().single();
  made.events.push(canceled.data.id);
  await admin.from("event_attendees").insert({ event_id: canceled.data.id, user_id: B.id });
  await admin.rpc("send_event_reminders");
  check("취소된 회의는 10분 전 알림이 없다", !has(await notes(canceled.data.id), B, "event_reminder"));

  // ── 권한 ──
  const bSees = await B.sb.from("notifications").select("id, type").eq("event_id", ev.data);
  const cSeesB = await C.sb.from("notifications").select("id").eq("user_id", B.id);
  check("본인 일정 알림만 조회된다", bSees.data?.length > 0 && cSeesB.data?.length === 0);

  // ── pg_cron 이 실제로 도는지 (1분마다) ──
  const auto = await A.sb.rpc("create_event", { p_title: `자동 알림 ${run}`, p_starts_at: inMin(3), p_ends_at: inMin(10), p_attendee_ids: [B.id] });
  made.events.push(auto.data);
  let got = false;
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    if (has(await notes(auto.data), B, "event_reminder")) {
      got = true;
      break;
    }
    await wait(5000);
  }
  check("pg_cron 이 1분 안에 10분 전 알림을 넣는다 (직접 부르지 않고)", got, `(${Math.round((Date.now() - started) / 1000)}초)`);
} catch (e) {
  results.push(`FAIL  검사 오류: ${e.message ?? e}`);
} finally {
  const errors = [];
  if (made.events.length) {
    const { error } = await admin.from("events").delete().in("id", made.events.filter(Boolean));
    if (error) errors.push(error.message);
  }
  if (made.rooms.length) await admin.from("rooms").delete().in("id", made.rooms);
  for (const id of made.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(error.message);
  }
  console.log(errors.length ? `정리 실패: ${errors.join(" / ")}` : `정리: 사용자 ${made.users.length}명, 회의 ${made.events.length}개, 회의실 ${made.rooms.length}개`);
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
