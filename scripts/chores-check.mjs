// 잡무 수첩 권한 자동 확인 (원격 Supabase).
// 실행: npm run check:chores
// 가상 사용자 A·B·C 를 만들고(비밀번호 없이 일회용 로그인 토큰), 끝나면 사용자·채널을 모두 지운다.
// A·B 는 채널 X 멤버, C 는 아니다. A 가 목록을 만든다.
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

async function makeUser(tag) {
  const email = `chores-check-${run}-${tag.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { handle: `ch${tag}${run}`, display_name: `잡무${tag}` },
  });
  if (error) throw error;
  made.users.push(data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const sb = createClient(url, anonKey, noSession);
  const { error: e2 } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (e2) throw e2;
  return { id: data.user.id, sb };
}

try {
  const A = await makeUser("A");
  const B = await makeUser("B");
  const C = await makeUser("C");
  const X = await A.sb.from("channels").insert({ name: `잡무검사-${run}`, type: "private" }).select().single();
  if (X.error) throw X.error;
  made.channels.push(X.data.id);
  // 비공개 채널이라 B 는 서버가 넣는다 (초대 권한과 상관없이 이 검사만 보려고)
  const addB = await admin.from("memberships").insert({ channel_id: X.data.id, user_id: B.id });
  if (addB.error) throw addB.error;

  // ── 목록 ──
  const list = await A.sb
    .from("chore_lists")
    .insert({ channel_id: X.data.id, title: "커피", place: "1층 카페", memo: "법인카드" })
    .select("id, created_by, updated_by")
    .single();
  check("멤버는 목록을 만든다 (만든 사람은 본인)", !list.error && list.data.created_by === A.id, `(${list.error?.message ?? ""})`);
  const L = list.data.id;

  const cMake = await C.sb.from("chore_lists").insert({ channel_id: X.data.id, title: "몰래" }).select();
  check("멤버가 아니면 목록을 못 만든다", !!cMake.error, `(${cMake.error?.code})`);
  const forge = await B.sb.from("chore_lists").insert({ channel_id: X.data.id, title: "위조", created_by: A.id }).select();
  check("만든 사람을 남으로 적을 수 없다 (컬럼 권한)", !!forge.error, `(${forge.error?.code})`);
  const blank = await A.sb.from("chore_lists").insert({ channel_id: X.data.id, title: "   " }).select();
  check("빈 이름 목록은 거부", !!blank.error, `(${blank.error?.code})`);

  // ── 기록 ──
  const e1 = await A.sb.from("chore_entries").insert({ list_id: L, person_name: "이부장님", detail: "아아 얼음 많이" }).select("id").single();
  const e2 = await B.sb.from("chore_entries").insert({ list_id: L, person_name: "김차장님", detail: "아이스라떼" }).select("id").single();
  check("멤버 둘 다 기록을 추가한다", !e1.error && !e2.error, `(${e1.error?.message ?? ""}${e2.error?.message ?? ""})`);
  const cAdd = await C.sb.from("chore_entries").insert({ list_id: L, person_name: "나", detail: "몰래" }).select();
  check("멤버가 아니면 기록을 못 추가한다", !!cAdd.error, `(${cAdd.error?.code})`);

  // ── 조회 ──
  const bSees = await B.sb.from("chore_lists").select("id, chore_entries(id)").eq("id", L).single();
  check("다른 멤버도 목록과 기록을 모두 본다 (인수인계)", bSees.data?.chore_entries?.length === 2, `(${bSees.data?.chore_entries?.length})`);
  const cLists = await C.sb.from("chore_lists").select("id").eq("channel_id", X.data.id);
  const cEntries = await C.sb.from("chore_entries").select("id").eq("list_id", L);
  check("멤버가 아니면 목록·기록이 0건", cLists.data?.length === 0 && cEntries.data?.length === 0, `(${cLists.data?.length}, ${cEntries.data?.length})`);

  // ── 수정 ──
  const bEdit = await B.sb.from("chore_entries").update({ detail: "아아 얼음 많이, 샷 추가" }).eq("id", e1.data.id).select("id");
  check("멤버는 남이 적은 기록도 고친다", bEdit.data?.length === 1, `(${bEdit.error?.message ?? bEdit.data?.length})`);
  const after = await admin.from("chore_lists").select("updated_by").eq("id", L).single();
  check("기록을 고치면 목록의 마지막 수정자가 바뀐다", after.data?.updated_by === B.id);
  const cEdit = await C.sb.from("chore_entries").update({ detail: "바꿈" }).eq("id", e1.data.id).select("id");
  check("멤버가 아니면 기록을 못 고친다 (0건)", cEdit.data?.length === 0);
  const move = await B.sb.from("chore_entries").update({ list_id: randomUUID() }).eq("id", e1.data.id).select("id");
  check("기록을 다른 목록으로 옮길 수 없다 (컬럼 권한)", !!move.error, `(${move.error?.code})`);
  const bPlace = await B.sb.from("chore_lists").update({ place: "2층 카페" }).eq("id", L).select("id");
  check("멤버는 장소·메모를 고친다", bPlace.data?.length === 1);
  const touch = await B.sb.from("chore_lists").update({ updated_by: A.id }).eq("id", L).select("id");
  check("마지막 수정자는 직접 못 바꾼다 (컬럼 권한)", !!touch.error, `(${touch.error?.code})`);

  // ── 삭제 ──
  const bDelList = await B.sb.from("chore_lists").delete().eq("id", L).select("id");
  check("만든 사람이 아니면 목록을 못 지운다 (0건)", bDelList.data?.length === 0);
  const cDelEntry = await C.sb.from("chore_entries").delete().eq("id", e2.data.id).select("id");
  check("멤버가 아니면 기록을 못 지운다 (0건)", cDelEntry.data?.length === 0);
  const bDelEntry = await B.sb.from("chore_entries").delete().eq("id", e2.data.id).select("id");
  check("멤버는 기록을 지운다", bDelEntry.data?.length === 1);
  const aDelList = await A.sb.from("chore_lists").delete().eq("id", L).select("id");
  const left = await admin.from("chore_entries").select("id").eq("list_id", L);
  check("만든 사람은 목록을 지우고, 기록도 같이 지워진다", aDelList.data?.length === 1 && left.data?.length === 0, `(${aDelList.error?.message ?? ""})`);
} catch (e) {
  results.push(`FAIL  검사 오류: ${e.message ?? e}`);
} finally {
  const errors = [];
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
