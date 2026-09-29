// 파일 첨부 완료 조건 자동 확인 (원격 Supabase + 첨부 API).
// 실행: npm run dev 를 띄운 채로 npm run check:attach   (다른 주소: BASE_URL=https://... npm run check:attach)
//
// 가상 사용자 A·B·C 를 service role 로 만들고, 비밀번호 없이 일회용 로그인 토큰(magic link)으로 세션을 얻어
// 로그인 쿠키로 API 를 부른다. A·B 는 DM 멤버, C 는 아니다. 끝나면 사용자·DM·올린 파일을 모두 지운다.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const base = process.env.BASE_URL ?? "http://localhost:3000";
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
const made = { users: [], channels: [], paths: [], realtime: [] };

const MB = 1024 * 1024;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32), Buffer.from([0xff, 0xd9])]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");
const FAKE_PNG = Buffer.from("이건 PNG 가 아니라 글자입니다. 확장자만 .png 로 바꿨습니다.");

async function makeUser(tag) {
  const email = `attach-check-${run}-${tag.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { handle: `att${tag}${run}`, display_name: `첨부${tag}` },
  });
  if (error) throw error;
  made.users.push(data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const sb = createClient(url, anonKey, noSession);
  const { data: s, error: e2 } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (e2) throw e2;
  await sb.realtime.setAuth(s.session.access_token);
  // 브라우저와 같은 로그인 쿠키를 만든다 (@supabase/ssr 형식)
  let cookies = [];
  const ssr = createServerClient(url, anonKey, { cookies: { getAll: () => [], setAll: (list) => (cookies = list) } });
  await ssr.auth.setSession({ access_token: s.session.access_token, refresh_token: s.session.refresh_token });
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const api = (path, init = {}) =>
    fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { ...init.headers, Cookie: cookie } });
  return { id: data.user.id, sb, api };
}

const postJson = (user, path, body) =>
  user.api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function sign(user, channel, name, mime, size) {
  const res = await postJson(user, "/api/attachments/sign", { channel_id: channel, file_name: name, mime, size });
  const body = await res.json().catch(() => ({}));
  if (body.path) made.paths.push(body.path);
  return { status: res.status, ...body };
}

async function confirm(user, channel, path, name, clientId = randomUUID(), text = "") {
  const res = await postJson(user, "/api/attachments/confirm", {
    channel_id: channel,
    path,
    file_name: name,
    client_id: clientId,
    body: text,
  });
  return { status: res.status, clientId, ...(await res.json().catch(() => ({}))) };
}

// 올리기 전체: 주소 받기 → Storage 에 올리기 → 확정
async function attach(user, channel, name, mime, bytes, text = "") {
  const s = await sign(user, channel, name, mime, bytes.length);
  if (s.status !== 200) return { stage: "sign", ...s };
  const up = await user.sb.storage.from("attachments").uploadToSignedUrl(s.path, s.token, bytes, { contentType: mime });
  if (up.error) return { stage: "upload", status: 0, error: up.error.message, path: s.path };
  return { stage: "confirm", path: s.path, ...(await confirm(user, channel, s.path, name, randomUUID(), text)) };
}

const exists = async (path) => {
  const { data } = await admin.storage.from("attachments").exists(path);
  return data === true;
};

try {
  const res0 = await fetch(`${base}/login`).catch((e) => ({ ok: false, statusText: e.message }));
  if (!res0.ok) throw new Error(`${base} 에 접속하지 못했습니다. npm run dev 를 먼저 띄우세요 (${res0.statusText})`);

  const A = await makeUser("A");
  const B = await makeUser("B");
  const C = await makeUser("C");
  const dm = await A.sb.rpc("create_dm", { other_user_id: B.id });
  if (dm.error) throw dm.error;
  made.channels.push(dm.data);

  // B 는 실시간으로 메시지와 첨부를 받는다
  const got = { messages: [], attachments: [] };
  const rt = B.sb
    .channel(`attach-check-${run}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${dm.data}` }, (p) => got.messages.push(p.new))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "attachments", filter: `channel_id=eq.${dm.data}` }, (p) => got.attachments.push(p.new));
  await new Promise((res, rej) => rt.subscribe((s, err) => (s === "SUBSCRIBED" ? res() : s !== "CLOSED" && rej(err ?? new Error(s)))));
  made.realtime.push({ sb: B.sb, channel: rt });
  await wait(500);

  // ── 올라가는 것 ──
  const png = await attach(A, dm.data, "화면 캡처.png", "image/png", PNG, "캡처 보냅니다");
  check("PNG 가 올라간다 (메시지·첨부 함께)", png.status === 200 && png.attachment?.mime === "image/png" && png.message?.body === "캡처 보냅니다", `(${png.stage} ${png.status} ${png.error ?? ""})`);
  const jpg = await attach(A, dm.data, "사진.jpg", "image/jpeg", JPEG);
  check("JPEG 가 올라간다 (글 없이 첨부만)", jpg.status === 200 && jpg.attachment?.mime === "image/jpeg" && jpg.message?.body === "", `(${jpg.stage} ${jpg.status} ${jpg.error ?? ""})`);
  const pdf = await attach(A, dm.data, "회의록.pdf", "application/pdf", PDF);
  check("PDF 가 올라간다", pdf.status === 200 && pdf.attachment?.mime === "application/pdf", `(${pdf.stage} ${pdf.status} ${pdf.error ?? ""})`);
  check("원래 파일 이름(한글)이 남는다", png.attachment?.file_name === "화면 캡처.png");

  await wait(2500);
  check("상대는 메시지와 첨부를 실시간으로 받는다", got.messages.length >= 3 && got.attachments.length >= 3, `(메시지 ${got.messages.length}, 첨부 ${got.attachments.length})`);

  // ── 막히는 것 ──
  const big = await sign(A, dm.data, "큰파일.png", "image/png", 5 * MB + 1);
  check("5MB 초과는 업로드 주소부터 거부 (저장 전)", big.status === 413 && !big.path, `(${big.status})`);
  const liar = await sign(A, dm.data, "작다고속임.png", "image/png", 1000);
  const bigUp = await A.sb.storage.from("attachments").uploadToSignedUrl(liar.path, liar.token, Buffer.alloc(6 * MB, 1), { contentType: "image/png" });
  check("크기를 속여도 버킷이 5MB 초과를 거부", !!bigUp.error && !(await exists(liar.path)), `(${bigUp.error?.message ?? "올라감"})`);
  const exe = await sign(A, dm.data, "a.exe", "application/octet-stream", 100);
  check("PNG·JPEG·PDF 가 아닌 형식은 거부", exe.status === 415, `(${exe.status})`);
  const fake = await attach(A, dm.data, "가짜.png", "image/png", FAKE_PNG);
  check("확장자만 .png 로 바꾼 파일은 서버가 거부", fake.status === 415, `(${fake.stage} ${fake.status})`);
  check("거부된 파일은 Storage 에 남지 않는다", !!fake.path && !(await exists(fake.path)));

  // ── 내려받기 권한 ──
  const id = png.attachment?.id;
  const bRes = await B.api(`/api/attachments/${id}`);
  const loc = bRes.headers.get("location");
  const bFile = loc ? await fetch(loc) : null;
  const bBytes = bFile?.ok ? Buffer.from(await bFile.arrayBuffer()) : null;
  check("B 는 DM 첨부를 연다", bRes.status === 302 && !!bBytes && bBytes.equals(PNG), `(${bRes.status}, ${bFile?.status})`);
  const cRes = await C.api(`/api/attachments/${id}`);
  check("C 는 API 로 못 연다 (404)", cRes.status === 404, `(${cRes.status})`);
  const cSign = await sign(C, dm.data, "c.png", "image/png", PNG.length);
  check("C 는 그 대화에 못 올린다 (403)", cSign.status === 403, `(${cSign.status})`);
  const pub = await fetch(`${url}/storage/v1/object/public/attachments/${png.path}`);
  check("C 는 파일 주소를 직접 열어도 못 본다 (공개 주소)", !pub.ok, `(${pub.status})`);
  const cDl = await C.sb.storage.from("attachments").download(png.path);
  check("C 는 자기 토큰으로 Storage 에서 직접 받아도 못 본다", !!cDl.error, `(${cDl.error?.message ?? "받아짐"})`);
  const cRow = await C.sb.from("attachments").select("id").eq("id", id);
  check("C 가 attachments 를 조회하면 0건", cRow.data?.length === 0);
  const nobody = await fetch(`${base}/api/attachments/${id}`, { redirect: "manual" });
  check("로그인하지 않으면 파일로 가지 않는다", nobody.status !== 302 || !String(nobody.headers.get("location")).includes("/storage/"), `(${nobody.status} → ${nobody.headers.get("location")})`);
  const steal = await confirm(B, dm.data, png.path, "훔침.png");
  check("남이 올린 파일은 확정 못 한다", steal.status === 400, `(${steal.status})`);

  // ── 다시 보내기 (멱등) ──
  const again = await confirm(A, dm.data, png.path, "화면 캡처.png", png.clientId, "캡처 보냅니다");
  const reup = await sign(A, dm.data, "화면 캡처.png", "image/png", PNG.length);
  await A.sb.storage.from("attachments").uploadToSignedUrl(reup.path, reup.token, PNG, { contentType: "image/png" });
  const again2 = await confirm(A, dm.data, reup.path, "화면 캡처.png", png.clientId, "캡처 보냅니다");
  const { count } = await admin.from("attachments").select("*", { count: "exact", head: true }).eq("message_id", png.message.id);
  check("같은 client_id 로 다시 확정해도 메시지·첨부는 하나", again.message?.id === png.message.id && again2.message?.id === png.message.id && count === 1, `(첨부 ${count}개)`);
  check("다시 올린 여분 파일은 지워진다", !(await exists(reup.path)));
} catch (e) {
  results.push(`FAIL  검사 오류: ${e.message ?? e}`);
} finally {
  for (const { sb, channel } of made.realtime) await sb.removeChannel(channel);
  const errors = [];
  if (made.paths.length) {
    const { error } = await admin.storage.from("attachments").remove(made.paths);
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
  console.log(errors.length ? `정리 실패: ${errors.join(" / ")}` : `정리: 사용자 ${made.users.length}명, 채널 ${made.channels.length}개, 파일 ${made.paths.length}개`);
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
