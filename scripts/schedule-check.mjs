// 일정 개편 권한·분류·팀원 보기 자동 확인 (원격 Supabase, 20260930230000_schedule_v2.sql · 20261001090000_schedule_fixes.sql).
// 실행: npm run check:schedule
// 시험용 팀 T(회사 아래)를 만들고 가상 사용자 A·B 를 넣는다. C 는 조직이 없다. A 가 일반 채널 X 를 만든다.
// 확인: 분류(팀 전원·일반 채널·부서 채널), category 를 사용자가 못 고침, 남의 채널을 못 걺,
//       list_team_events 가 공개 범위만큼만 주는지(바쁨은 유형도 없음, 병가 → 휴가, 휴직 → 부재), 다른 부서는 못 봄,
//       종일 일정 초대자는 알림 없음, 반복(만들기·이후 모두 고치기·취소·초대 한 번), 참석자와 대화(DM·비공개 채널).
//       끝나면 사용자·채널·팀을 모두 지운다.
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
const made = { users: [], channels: [], unit: null, unitChannel: null };

async function makeUser(tag) {
  const email = `schedule-check-${run}-${tag.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { handle: `sc${tag}${run}`, display_name: `일정검사${tag}` },
  });
  if (error) throw error;
  made.users.push(data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const sb = createClient(url, anonKey, noSession);
  const { error: e2 } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (e2) throw e2;
  return { id: data.user.id, sb };
}

const day = new Date(Date.now() + 3 * 86400000);
const at = (h) => new Date(day.getTime() + h * 3600000).toISOString();
const base = { p_title: "일정 검사", p_starts_at: at(0), p_ends_at: at(1) };
const mk = async (who, args) => {
  const { data, error } = await who.sb.rpc("create_event", { ...base, ...args });
  if (error) throw new Error(`create_event: ${error.message}`);
  return data;
};

try {
  const company = await admin.from("org_units").select("id").eq("kind", "company").single();
  if (company.error) throw company.error;
  const T = await admin.from("org_units").insert({ name: `일정검사-${run}`, kind: "team", parent_id: company.data.id }).select("id, channel_id").single();
  if (T.error) throw T.error;
  made.unit = T.data.id;
  made.unitChannel = T.data.channel_id;

  const A = await makeUser("A");
  const B = await makeUser("B");
  const C = await makeUser("C");
  const put = await admin.from("profiles").update({ org_unit_id: T.data.id }).in("id", [A.id, B.id]);
  if (put.error) throw put.error;
  const X = await A.sb.from("channels").insert({ name: `일정검사-${run}`, type: "private" }).select().single();
  if (X.error) throw X.error;
  made.channels.push(X.data.id);

  // ── 분류 ──
  const cat = async (id) => (await admin.from("events").select("category, team_unit_id").eq("id", id).single()).data;
  const team = await mk(A, { p_attendee_ids: [B.id] });
  check("팀 전원이 참석자인 회의 → 팀 일정", (await cat(team))?.category === "team" && (await cat(team))?.team_unit_id === T.data.id);
  const alone = await mk(A, {});
  check("팀 일부만 → 내 일정", (await cat(alone))?.category === "mine");
  const project = await mk(A, { p_channel_id: X.data.id });
  check("일반 채널에서 만든 회의 → 프로젝트 일정", (await cat(project))?.category === "project");
  const dept = await mk(A, { p_channel_id: T.data.channel_id });
  check("부서 채널에서 만들고 일부만 → 내 일정", (await cat(dept))?.category === "mine");
  const foreign = await C.sb.rpc("create_event", { ...base, p_channel_id: X.data.id });
  check("멤버가 아닌 채널로는 못 만든다", foreign.error?.code === "42501", `(${foreign.error?.code})`);
  const forge = await A.sb.from("events").update({ category: "team" }).eq("id", alone).select("id");
  check("분류(category)는 사용자가 못 고친다", !!forge.error, `(${forge.error?.code})`);

  // ── 같은 부서 팀원에게 보이는 것 ──
  const workPub = await mk(A, { p_title: "시안 마감", p_kind: "work", p_attendee_ids: [C.id] });
  const workTime = await mk(A, { p_title: "비밀 작업", p_kind: "work", p_visibility: "time_only" });
  const hospital = await mk(A, { p_title: "치과", p_kind: "personal", p_subtype: "hospital" });
  const personalPub = await mk(A, { p_title: "치과", p_kind: "personal", p_visibility: "public" });
  const outTime = await mk(A, { p_title: "B사 방문", p_kind: "outside", p_location: "강남 B사", p_visibility: "time_only" });
  const sick = await mk(A, { p_title: "병가", p_kind: "leave", p_subtype: "sick", p_all_day: true, p_remind_minutes: [] });
  const absence = await mk(A, { p_title: "휴직", p_kind: "leave", p_subtype: "leave_of_absence", p_all_day: true, p_remind_minutes: [] });
  const secret = await mk(A, { p_title: "나만", p_kind: "personal", p_visibility: "private" });
  const range = { p_from: new Date().toISOString(), p_to: new Date(Date.now() + 10 * 86400000).toISOString() };
  const seenB = await B.sb.rpc("list_team_events", range);
  if (seenB.error) throw seenB.error;
  const v = new Map(seenB.data.map((r) => [r.event_id, r]));
  check("회의는 팀원에게 주지 않는다", !v.has(alone) && !v.has(project));
  check("업무·팀에 공개 → 일정명·담당자", v.get(workPub)?.title === "시안 마감" && v.get(workPub)?.assignees?.length === 2);
  check("업무·시간만 → 바쁨, 유형·제목 없음", v.get(workTime)?.label === "바쁨" && v.get(workTime)?.kind === null && v.get(workTime)?.title === null);
  check("개인은 기본이 시간만 → 바쁨, 유형 없음", v.get(hospital)?.label === "바쁨" && v.get(hospital)?.kind === null);
  check("개인·팀에 공개 → '개인 일정', 제목 없음", v.get(personalPub)?.label === "개인 일정" && v.get(personalPub)?.title === null);
  check("외근·시간만 → '외근', 장소·제목 없음", v.get(outTime)?.label === "외근" && v.get(outTime)?.location === null && v.get(outTime)?.title === null);
  check("병가를 공개해도 '휴가'로만", v.get(sick)?.label === "휴가");
  check("휴직을 공개해도 '부재'로만", v.get(absence)?.label === "부재");
  check("나만 보기는 주지 않는다", !v.has(secret));
  const rowsB = await B.sb.from("events").select("id").in("id", [hospital, workTime, sick]);
  check("팀원도 일정 행은 못 읽는다 (RLS 그대로)", rowsB.data?.length === 0);
  const seenC = await C.sb.rpc("list_team_events", range);
  check("다른 부서(조직 없음)는 아무것도 못 본다", seenC.data?.length === 0);
  const seenCAttendee = (await C.sb.from("events").select("id").eq("id", workPub)).data?.length === 1;
  check("담당자로 초대된 사람은 일정을 그대로 읽는다", seenCAttendee);

  // ── 알림 ──
  const allDay = await mk(A, { p_kind: "work", p_all_day: true, p_attendee_ids: [B.id], p_remind_minutes: [] });
  const remB = await admin.from("event_attendees").select("remind_minutes").eq("event_id", allDay).eq("user_id", B.id).single();
  check("종일 일정의 초대자는 알림 없음", remB.data?.remind_minutes?.length === 0, JSON.stringify(remB.data?.remind_minutes));
  const bad = await A.sb.from("event_attendees").update({ remind_minutes: [0] }).eq("event_id", alone).eq("user_id", A.id).select("event_id");
  check("알림은 5·10·30·60·1440분 전만", bad.error?.code === "23514", `(${bad.error?.code})`);

  // ── 반복 (20261001120000) ──
  // 종료일은 한국 날짜로 (시작의 한국 날짜 + 21일 → 4회차)
  const until = new Date(day.getTime() + 9 * 3600000 + 21 * 86400000).toISOString().slice(0, 10);
  const first = await A.sb.rpc("create_event_series", { ...base, p_title: "반복 검사", p_repeat: "weekly", p_until: until, p_attendee_ids: [B.id] });
  if (first.error) throw new Error(`create_event_series: ${first.error.message}`);
  const sid = (await admin.from("events").select("series_id").eq("id", first.data).single()).data.series_id;
  const occ = (await admin.from("events").select("id, starts_at").eq("series_id", sid).order("starts_at")).data;
  check("매주 반복 3주 → 4회차", occ.length === 4, `(${occ.length})`);
  const invB = (await admin.from("notifications").select("id").eq("user_id", B.id).eq("type", "event_invite").in("event_id", occ.map((o) => o.id))).data;
  check("반복 초대 알림은 한 번", invB.length === 1, `(${invB.length})`);
  const upd = await A.sb.rpc("update_event_series", {
    p_event: occ[2].id, p_title: "반복 검사(변경)", p_description: null, p_kind: "meeting", p_subtype: null, p_all_day: false,
    p_location: null, p_visibility: "public", p_room_id: null, p_channel_id: null, p_start_time: "15:00", p_end_time: "16:00",
    p_attendee_ids: [B.id], p_remind_minutes: [30],
  });
  check("이후 모두 고치기 → 뒤 2회차", upd.data === 2, `(${upd.error?.message ?? upd.data})`);
  const byB = await B.sb.rpc("cancel_event_series", { p_event: occ[1].id });
  check("참석자는 이후 모두 취소 못 함", byB.error?.code === "42501", `(${byB.error?.code})`);
  const can = await A.sb.rpc("cancel_event_series", { p_event: occ[1].id });
  check("이후 모두 취소 → 3회차, 첫 회차는 남음", can.data === 3 && (await admin.from("events").select("canceled_at").eq("id", occ[0].id).single()).data.canceled_at === null);

  // ── 참석자와 대화 ──
  const pair = await mk(A, { p_title: "둘이 회의", p_attendee_ids: [B.id] });
  const dm = await A.sb.rpc("open_event_chat", { p_event: pair });
  const dmType = (await admin.from("channels").select("type").eq("id", dm.data).single()).data?.type;
  check("상대가 한 명이면 DM 을 연다", dmType === "dm", `(${dm.error?.message ?? dmType})`);
  if (dm.data) made.channels.push(dm.data);
  const group = await mk(A, { p_title: "여럿 회의", p_attendee_ids: [B.id, C.id] });
  const g1 = await B.sb.rpc("open_event_chat", { p_event: group });
  if (g1.data) made.channels.push(g1.data);
  const gm = (await admin.from("memberships").select("user_id").eq("channel_id", g1.data)).data ?? [];
  check("여럿이면 참석자 모두가 멤버인 비공개 채널", gm.length === 3, `(${g1.error?.message ?? gm.length})`);
  const g2 = await C.sb.rpc("open_event_chat", { p_event: group });
  check("다시 열면 같은 대화방", g2.data === g1.data);
  const stranger = await makeUser("D");
  const g3 = await stranger.sb.rpc("open_event_chat", { p_event: group });
  check("참석자가 아니면 대화를 못 연다", g3.error?.code === "42501", `(${g3.error?.code})`);
} catch (e) {
  results.push(`FAIL  검사 오류: ${e.message ?? e}`);
} finally {
  const errors = [];
  // 채널(대화방·DM)을 먼저 지운다 (메시지가 없어 바로 지워진다). 사용자를 지우면 그 사람이 만든 일정·참석·알림·멤버십이 같이 지워진다.
  // 팀은 사람이 빠진 뒤, 부서 채널은 팀 뒤에
  if (made.channels.length) {
    const { error } = await admin.from("channels").delete().in("id", made.channels);
    if (error) errors.push(error.message);
    made.channels = [];
  }
  for (const id of made.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(error.message);
  }
  if (made.channels.length) {
    const { error } = await admin.from("channels").delete().in("id", made.channels);
    if (error) errors.push(error.message);
  }
  if (made.unit) {
    const { error } = await admin.from("org_units").delete().eq("id", made.unit);
    if (error) errors.push(error.message);
    const { error: e2 } = await admin.from("channels").delete().eq("id", made.unitChannel);
    if (e2) errors.push(e2.message);
  }
  console.log(errors.length ? `정리 실패: ${errors.join(" / ")}` : `정리: 사용자 ${made.users.length}명, 시험 채널·팀 1개`);
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
