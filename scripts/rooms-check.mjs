// 회의실 예약 정책·시간표 자동 확인 (원격 Supabase, 20261001170000_rooms_v2.sql — WU-46).
// 실행: npm run check:rooms
// 시험용 회의실 2개와 가상 사용자 A·B 를 만든다 (실제 회의실 예약은 건드리지 않는다).
// 확인: 30분 단위 · 운영 시간 · 4시간 · 90일 · 지난 시각 · 종일 거부, 같은 사람 같은 시간 두 곳 거부, 남과 겹침(23P01),
//       room_board 가 공개 회의만 예약자 이름·부서를 주고 비공개·제목은 숨기는지, 진행 중 예약은 시작 고정·일찍 끝내기만·취소 거부,
//       시작한 예약에서 회의실 빼기·종일 바꾸기 거부(20261001190000), 회의실 8개와 시설 칸. 끝나면 사용자(→ 예약)·회의실을 모두 지운다.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
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
const made = { users: [], rooms: [] };

async function makeUser(tag) {
  const email = `rooms-check-${run}-${tag.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { handle: `rc${tag}${run}`, display_name: `회의실검사${tag}` },
  });
  if (error) throw error;
  made.users.push(data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const sb = createClient(url, anonKey, noSession);
  const { error: e2 } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (e2) throw e2;
  return { id: data.user.id, sb };
}

/** 오늘(한국)부터 n일 뒤의 "YYYY-MM-DD" */
const kstDay = (n) => {
  const d = new Date(Date.now() + 9 * 3600e3 + n * 86400e3);
  return d.toISOString().slice(0, 10);
};
const at = (day, hm) => `${day}T${hm}:00+09:00`;
const D = kstDay(3);
const book = (who, room, s, e, extra = {}) =>
  who.sb.rpc("create_event", { p_title: "회의실 검사", p_starts_at: s, p_ends_at: e, p_room_id: room, ...extra });
const code = (r) => r.error?.code ?? "성공";

try {
  const R1 = await admin.from("rooms").insert({ name: `회의실검사A-${run}`, capacity: 4, location: "9층", facilities: ["monitor"] }).select("id").single();
  const R2 = await admin.from("rooms").insert({ name: `회의실검사B-${run}`, capacity: 6, location: "9층" }).select("id").single();
  if (R1.error || R2.error) throw R1.error ?? R2.error;
  made.rooms.push(R1.data.id, R2.data.id);
  const r1 = R1.data.id;
  const r2 = R2.data.id;

  const A = await makeUser("A");
  const B = await makeUser("B");

  // ── 회의실 칸 ──
  const all = await admin.from("rooms").select("name, facilities, sort_order").in("name", ["C1 상생", "C2 신뢰", "C3 열정", "C4 이끔", "M1 확산", "M2 공유", "M3 가치", "M4 연구"]);
  check("회의실 8개와 시설 칸", all.data?.length === 8 && all.data.every((r) => r.facilities.length > 0), `(${all.data?.length})`);
  const badFac = await admin.from("rooms").update({ facilities: ["coffee"] }).eq("id", r1);
  check("모르는 시설은 못 넣는다", badFac.error?.code === "23514", `(${badFac.error?.code})`);

  // ── 정책 ──
  let r = await book(A, r1, at(D, "10:05"), at(D, "11:05"));
  check("30분 단위가 아니면 거부", r.error?.code === "P0001" && /30분 단위/.test(r.error.message), `(${code(r)})`);
  r = await book(A, r1, at(D, "07:30"), at(D, "08:30"));
  check("운영 시간(08~21시) 밖 거부", r.error?.code === "P0001", `(${code(r)})`);
  r = await book(A, r1, at(D, "09:00"), at(D, "14:00"));
  check("4시간 넘으면 거부", r.error?.code === "P0001" && /최대 4시간/.test(r.error.message), `(${code(r)})`);
  r = await book(A, r1, at(kstDay(95), "10:00"), at(kstDay(95), "11:00"));
  check("90일 넘으면 거부", r.error?.code === "P0001" && /90일/.test(r.error.message), `(${code(r)})`);
  r = await book(A, r1, at(kstDay(-1), "10:00"), at(kstDay(-1), "11:00"));
  check("지난 시각 거부", r.error?.code === "P0001" && /지난 시각/.test(r.error.message), `(${code(r)})`);
  r = await book(A, r1, at(D, "00:00"), at(kstDay(4), "00:00"), { p_all_day: true });
  check("종일 거부", r.error?.code === "P0001" && /종일/.test(r.error.message), `(${code(r)})`);
  const pub = await book(A, r1, at(D, "10:00"), at(D, "11:00"));
  check("규칙에 맞으면 예약된다 (공개 회의)", !pub.error, `(${code(pub)})`);
  const priv = await book(A, r1, at(D, "13:00"), at(D, "14:00"), { p_visibility: "private" });
  check("비공개 회의도 예약된다", !priv.error, `(${code(priv)})`);
  r = await book(A, r2, at(D, "10:30"), at(D, "11:30"));
  check("같은 사람이 같은 시간에 두 곳 거부", r.error?.code === "P0001" && /두 곳/.test(r.error.message), `(${code(r)})`);
  r = await book(B, r1, at(D, "10:30"), at(D, "11:00"));
  check("남의 예약과 겹치면 거부 (23P01)", r.error?.code === "23P01", `(${code(r)})`);
  r = await book(B, r1, at(D, "11:00"), at(D, "12:00"));
  check("끝나는 시각에 바로 이어서는 된다", !r.error, `(${code(r)})`);

  // ── 시간표 (room_board) ──
  const boardB = await B.sb.rpc("room_board", { p_from: at(D, "00:00"), p_to: at(kstDay(4), "00:00") });
  const rowsB = (boardB.data ?? []).filter((x) => x.room_id === r1);
  const pubRow = rowsB.find((x) => x.starts_at && new Date(x.starts_at).getTime() === new Date(at(D, "10:00")).getTime());
  const privRow = rowsB.find((x) => new Date(x.starts_at).getTime() === new Date(at(D, "13:00")).getTime());
  check("남에게: 공개 회의는 예약자 이름, 제목·id 는 없음", !!pubRow?.booker_name && pubRow.booker_name === "회의실검사A" && !pubRow.title && !pubRow.event_id && !pubRow.mine);
  check("남에게: 비공개 회의는 예약자도 없음", !!privRow && privRow.is_private && !privRow.booker_name && !privRow.booker_id && !privRow.title);
  const boardA = await A.sb.rpc("room_board", { p_from: at(D, "00:00"), p_to: at(kstDay(4), "00:00") });
  const mineA = (boardA.data ?? []).filter((x) => x.room_id === r1 && x.mine);
  check("나에게: 내 예약은 제목·id", mineA.length === 2 && mineA.every((x) => x.title && x.event_id));
  const wide = await A.sb.rpc("room_board", { p_from: at(D, "00:00"), p_to: at(kstDay(20), "00:00") });
  check("한 번에 8일 넘게는 주지 않는다", !wide.error && (wide.data ?? []).length === 0);
  const anon = await createClient(url, anonKey, noSession).rpc("room_board", { p_from: at(D, "00:00"), p_to: at(kstDay(4), "00:00") });
  check("로그인하지 않으면 못 부른다", !!anon.error || (anon.data ?? []).length === 0, `(${anon.error?.code ?? "0행"})`);

  r = await A.sb.from("events").update({ all_day: true }).eq("id", priv.data).select("id");
  check("시각 그대로 종일로 바꾸기 거부", r.error?.code === "P0001" && /종일/.test(r.error.message), `(${code(r)})`);

  // ── 진행 중 예약 (서비스 키로 넣으면 규칙을 건너뛴다) — 진행 중 칸이 하루 안·21시 안에 있어야 해서 00:30~20:30 에만 ──
  const kstMin = (new Date(Date.now() + 9 * 3600e3).getUTCHours() * 60) + new Date().getUTCMinutes();
  if (kstMin < 30 || kstMin >= 20 * 60 + 30) {
    results.push("SKIP  진행 중 예약 검사 4개 (00:30~20:30 에만 돈다)");
  } else {
  const slot = Math.floor(Date.now() / 1800e3) * 1800e3;
  const running = await admin
    .from("events")
    .insert({ title: "진행 중 검사", starts_at: new Date(slot - 1800e3).toISOString(), ends_at: new Date(slot + 3600e3).toISOString(), room_id: r2, created_by: B.id })
    .select("id")
    .single();
  if (running.error) throw running.error;
  await admin.from("event_attendees").insert({ event_id: running.data.id, user_id: B.id, response: "accepted" });
  r = await B.sb.from("events").update({ room_id: null }).eq("id", running.data.id).select("id");
  check("진행 중 예약에서 회의실 빼기 거부", r.error?.code === "P0001" && /회의실을 뺄 수 없습니다/.test(r.error.message), `(${code(r)})`);
  r = await B.sb.from("events").update({ starts_at: new Date(slot).toISOString() }).eq("id", running.data.id).select("id");
  check("진행 중이면 시작을 못 옮긴다", r.error?.code === "P0001", `(${code(r)})`);
  r = await B.sb.from("events").update({ canceled_at: new Date().toISOString() }).eq("id", running.data.id).select("id");
  check("시작한 예약은 취소 거부", r.error?.code === "P0001" && /일찍 끝내기/.test(r.error.message), `(${code(r)})`);
  r = await B.sb.from("events").update({ ends_at: new Date(slot + 1800e3).toISOString() }).eq("id", running.data.id).select("id");
  check("진행 중이면 종료를 당겨 일찍 끝낸다", !r.error && r.data?.length === 1, `(${code(r)})`);
  }
  r = await A.sb.from("events").update({ canceled_at: new Date().toISOString() }).eq("id", pub.data).select("id");
  check("시작 전 예약은 예약자가 취소한다", !r.error && r.data?.length === 1, `(${code(r)})`);
} catch (e) {
  results.push(`FAIL  실행 중 오류: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
} finally {
  const errors = [];
  for (const id of made.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(error.message);
  }
  if (made.rooms.length) {
    const { error } = await admin.from("rooms").delete().in("id", made.rooms);
    if (error) errors.push(error.message);
  }
  console.log(results.join("\n"));
  const failed = results.filter((l) => l.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}개 통과, ${failed}개 실패`);
  console.log(errors.length ? `정리 실패: ${errors.join(" / ")}` : `정리: 사용자 ${made.users.length}명(예약 포함), 시험 회의실 ${made.rooms.length}개`);
  process.exitCode = failed || errors.length ? 1 : 0;
}
