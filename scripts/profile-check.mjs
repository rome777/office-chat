// 내 프로필 권한·제약 자동 확인 (WU-33, 원격 Supabase, 마이그레이션 20260930130000_my_profile.sql)
// 실행: npm run check:profile  (.env.local 의 Supabase 값과 service role 키를 쓴다)
//
// 가상 사용자 A·B·관리자를 service role 로 만들고 일회용 로그인 토큰(magic link)으로 접속한다 (db-v1-check 와 같은 방식).
// 끝나면 만든 사용자와 보관함 파일을 모두 지운다 (실패해도 지운다). 연락처는 사용자를 지우면 같이 지워진다.
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
const made = [];
const code = (r) => `(${r.error?.code ?? r.error?.message ?? "ok"})`;

async function makeUser(tag, role) {
  const email = `profile-check-${run}-${tag.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { handle: `pchk${tag}${run}`, display_name: `검사${tag}`, department: "검사팀" },
  });
  if (error) throw error;
  made.push(data.user.id);
  if (role) await admin.from("profiles").update({ role }).eq("id", data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const sb = createClient(url, anonKey, noSession);
  const { error: e2 } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (e2) throw e2;
  return { id: data.user.id, sb };
}

// 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

try {
  const A = await makeUser("A");
  const B = await makeUser("B");
  const M = await makeUser("M", "admin");
  const anon = createClient(url, anonKey, noSession);
  const mine = (sb, id, patch) => sb.from("profiles").update(patch).eq("id", id).select();

  // ── 기본 정보 잠금 ──
  for (const [col, value] of [["display_name", "대표이사"], ["handle", `x${run}`], ["department", "경영진"], ["title", "대표"]]) {
    const r = await mine(A.sb, A.id, { [col]: value });
    check(`본인 ${col} 는 고칠 수 없다`, r.error?.code === "42501", code(r));
  }

  // ── 상태·상태 메시지·사진 ──
  const st = await mine(A.sb, A.id, { status: "dnd", status_message: "회의 준비 중" });
  check("본인 상태·상태 메시지는 고친다", st.data?.[0]?.status === "dnd" && st.data?.[0]?.status_message === "회의 준비 중", code(st));
  const inv = await mine(A.sb, A.id, { status: "invisible" });
  check("오프라인으로 표시(invisible)를 고를 수 있다", inv.data?.[0]?.status === "invisible", code(inv));
  const badSt = await mine(A.sb, A.id, { status: "offline" });
  check("정해진 것 밖의 상태는 거부", badSt.error?.code === "23514", code(badSt));
  const longMsg = await mine(A.sb, A.id, { status_message: "가".repeat(61) });
  check("상태 메시지 61자는 거부", longMsg.error?.code === "23514", code(longMsg));
  const other = await mine(A.sb, B.id, { status: "away" });
  check("남의 상태는 못 고친다 (0건)", !other.error && other.data?.length === 0, code(other));
  const ch = await mine(A.sb, A.id, { avatar: "char:bear" });
  check("캐릭터를 고른다", ch.data?.[0]?.avatar === "char:bear", code(ch));
  const badCh = await mine(A.sb, A.id, { avatar: "char:Bad!" });
  check("캐릭터 id 형식이 틀리면 거부", badCh.error?.code === "23514", code(badCh));
  const otherPhoto = await mine(A.sb, A.id, { avatar: `photo:${B.id}/abc.webp` });
  check("남의 폴더 사진을 내 사진으로 못 한다", otherPhoto.error?.code === "23514", code(otherPhoto));
  const ownPhoto = await mine(A.sb, A.id, { avatar: `photo:${A.id}/abc_1.webp` });
  check("내 폴더 사진은 내 사진으로 한다", ownPhoto.data?.length === 1, code(ownPhoto));
  const roleUp = await mine(A.sb, A.id, { role: "admin" });
  check("role 은 여전히 못 고친다", roleUp.error?.code === "42501", code(roleUp));

  // ── 연락처 ──
  const up = await A.sb.from("profile_contacts").upsert({ phone: "010-1111-2222", is_public: false }, { onConflict: "user_id" }).select();
  check("본인 연락처를 저장한다 (비공개)", up.data?.[0]?.user_id === A.id && up.data?.[0]?.is_public === false, code(up));
  const readB = await B.sb.from("profile_contacts").select("phone").eq("user_id", A.id);
  check("비공개 연락처는 남이 못 본다", !readB.error && readB.data?.length === 0, code(readB));
  const readM = await M.sb.from("profile_contacts").select("phone").eq("user_id", A.id);
  check("비공개 연락처도 관리자는 본다", readM.data?.[0]?.phone === "010-1111-2222", code(readM));
  const readA = await A.sb.from("profile_contacts").select("phone").eq("user_id", A.id);
  check("비공개 연락처를 본인은 본다", readA.data?.length === 1, code(readA));
  const pub = await A.sb.from("profile_contacts").upsert({ phone: "010-1111-2222", is_public: true }, { onConflict: "user_id" }).select();
  const readB2 = await B.sb.from("profile_contacts").select("phone").eq("user_id", A.id);
  check("공개로 바꾸면 남도 본다", !pub.error && readB2.data?.[0]?.phone === "010-1111-2222", code(readB2));
  const readAnon = await anon.from("profile_contacts").select("phone").eq("user_id", A.id);
  check("로그인 안 하면 공개 연락처도 못 본다", readAnon.error?.code === "42501" || readAnon.data?.length === 0, code(readAnon));
  const bEdit = await B.sb.from("profile_contacts").update({ phone: "000" }).eq("user_id", A.id).select();
  check("남의 연락처는 못 고친다 (0건)", !bEdit.error && bEdit.data?.length === 0, code(bEdit));
  const bFake = await B.sb.from("profile_contacts").insert({ user_id: A.id, phone: "000" });
  check("남의 이름으로 연락처를 못 만든다", bFake.error?.code === "42501", code(bFake));
  const badPhone = await A.sb.from("profile_contacts").update({ phone: "<script>" }).eq("user_id", A.id).select();
  check("연락처 형식이 틀리면 거부", badPhone.error?.code === "23514", code(badPhone));

  // ── 프로필 사진 보관함 ──
  const { data: bucket } = await admin.storage.getBucket("avatars");
  check("avatars 버킷은 공개 읽기, 2MB, WEBP·JPEG·PNG", bucket?.public === true && Number(bucket?.file_size_limit) === 2097152 && bucket?.allowed_mime_types?.length === 3);
  const ownUp = await A.sb.storage.from("avatars").upload(`${A.id}/check-${run}.png`, PNG, { contentType: "image/png" });
  check("내 폴더에 사진을 올린다", !ownUp.error, `(${ownUp.error?.message ?? "ok"})`);
  const otherUp = await A.sb.storage.from("avatars").upload(`${B.id}/check-${run}.png`, PNG, { contentType: "image/png" });
  check("남의 폴더에는 못 올린다", !!otherUp.error, `(${otherUp.error?.message ?? "올라감"})`);
  const html = await A.sb.storage.from("avatars").upload(`${A.id}/check-${run}.html`, Buffer.from("<script>alert(1)</script>"), { contentType: "text/html" });
  check("사진이 아닌 형식은 버킷이 거부", !!html.error, `(${html.error?.message ?? "올라감"})`);
  const publicUrl = A.sb.storage.from("avatars").getPublicUrl(`${A.id}/check-${run}.png`).data.publicUrl;
  const fetched = await fetch(publicUrl);
  check("올린 사진은 공개 주소로 열린다", fetched.ok, `(${fetched.status})`);
  await B.sb.storage.from("avatars").remove([`${A.id}/check-${run}.png`]);
  const still = await admin.storage.from("avatars").list(A.id);
  check("남의 사진은 못 지운다", still.data?.some((f) => f.name === `check-${run}.png`) === true);
  const del = await A.sb.storage.from("avatars").remove([`${A.id}/check-${run}.png`]);
  const gone = await admin.storage.from("avatars").list(A.id);
  check("내 사진은 지운다", del.data?.length === 1 && !gone.data?.some((f) => f.name === `check-${run}.png`), `(${del.error?.message ?? del.data?.length})`);

  // ── 비밀번호 바꾸기 (화면의 changePassword 와 같은 순서: 지금 비밀번호로 다시 로그인 → updateUser) ──
  // 비밀번호는 이 검사에서 새로 만든 임의 값이다. 사용자는 끝에 지운다
  const oldPw = `Chk-${randomUUID()}`;
  const newPw = `Chk-${randomUUID()}`;
  const pwEmail = `profile-check-${run}-p@example.com`;
  const P = await admin.auth.admin.createUser({ email: pwEmail, password: oldPw, email_confirm: true, user_metadata: { handle: `pchkP${run}`, display_name: "검사P" } });
  if (P.error) throw P.error;
  made.push(P.data.user.id);
  const ps = createClient(url, anonKey, noSession);
  await ps.auth.signInWithPassword({ email: pwEmail, password: oldPw });
  const wrong = await ps.auth.signInWithPassword({ email: pwEmail, password: `${oldPw}x` });
  check("지금 비밀번호가 틀리면 확인에서 걸린다", !!wrong.error, `(${wrong.error?.code ?? "통과됨"})`);
  const again = await ps.auth.signInWithPassword({ email: pwEmail, password: oldPw });
  const changed = again.error ? again : await ps.auth.updateUser({ password: newPw });
  check("지금 비밀번호로 확인하면 새 비밀번호로 바뀐다", !changed.error, `(${changed.error?.code ?? changed.error?.message ?? "ok"})`);
  const fresh = createClient(url, anonKey, noSession);
  const withNew = await fresh.auth.signInWithPassword({ email: pwEmail, password: newPw });
  const withOld = await createClient(url, anonKey, noSession).auth.signInWithPassword({ email: pwEmail, password: oldPw });
  check("바꾼 뒤 새 비밀번호로 로그인되고 옛 비밀번호는 안 된다", !withNew.error && !!withOld.error, `(${withNew.error?.code ?? "새 ok"} / ${withOld.error?.code ?? "옛 ok"})`);
} catch (e) {
  results.push(`FAIL  검사 오류: ${e.message ?? e}`);
} finally {
  const errors = [];
  for (const id of made) {
    const { data } = await admin.storage.from("avatars").list(id);
    if (data?.length) {
      const { error } = await admin.storage.from("avatars").remove(data.map((f) => `${id}/${f.name}`));
      if (error) errors.push(error.message);
    }
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(error.message);
  }
  console.log(errors.length ? `정리 실패: ${errors.join(" / ")}` : `정리: 사용자 ${made.length}명과 그 사진·연락처`);
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
