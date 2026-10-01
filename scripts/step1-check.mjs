// Step 1 통과 테스트 자동 확인 (A·B 두 사용자, 원격 Supabase).
// 실행: npm run check:step1  (.env.local 의 Supabase 값을 쓴다)
// 2026-10-01: 익명(Step 1 임시 호환)이 닫혀서(20261001200000_close_step1_anon) 익명 #일반 대신
//   가상 사용자 A·B 가 로그인해 둘만 있는 비공개 시험 채널에서 같은 것을 확인한다 —
//   실시간 송수신·지연, 공백 거부, 멱등 전송, 재접속 동기화, 위조·남의 글 지우기 거부, HTML 원문 보존.
// 끝나면 시험 채널(→ 메시지)과 사용자를 service role 키로 지운다.
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
const made = { users: [], channel: null };

async function makeUser(tag) {
  const email = `step1-check-${run}-${tag.toLowerCase()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { handle: `s1${tag}${run}`, display_name: `테스트${tag}` },
  });
  if (error) throw error;
  made.users.push(data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const sb = createClient(url, anonKey, noSession);
  const { error: e2 } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (e2) throw e2;
  return { id: data.user.id, sb };
}

async function listen(who, channelId) {
  const received = [];
  const channel = who.sb
    .channel(`check-${who.id}-${randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` }, (p) =>
      received.push({ m: p.new, at: Date.now() }),
    );
  await new Promise((res, rej) =>
    channel.subscribe((s) => (s === "SUBSCRIBED" ? res() : s !== "CLOSED" && rej(new Error(s)))),
  );
  return { ...who, channel, received };
}

const send = (who, body, clientId = randomUUID()) =>
  who.sb
    .from("messages")
    .upsert({ client_id: clientId, channel_id: made.channel, body }, { onConflict: "client_id", ignoreDuplicates: true })
    .select();

try {
  const userA = await makeUser("A");
  const userB = await makeUser("B");
  const ch = await userA.sb.from("channels").insert({ name: `step1검사-${run}`, type: "private" }).select("id").single();
  if (ch.error) throw ch.error;
  made.channel = ch.data.id;
  const join = await admin.from("memberships").insert({ channel_id: made.channel, user_id: userB.id });
  if (join.error) throw join.error;

  const A = await listen(userA, made.channel);
  const B = await listen(userB, made.channel);
  await wait(500);

  // 1. 각자 5개 → 상대가 받는지, 지연
  const sentAt = new Map();
  for (let i = 1; i <= 5; i++) {
    for (const [c, who] of [[A, "A"], [B, "B"]]) {
      const body = `테스트${who}-${i}-${randomUUID().slice(0, 4)}`;
      sentAt.set(body, Date.now());
      const { error } = await send(c, body);
      if (error) throw error;
    }
  }
  await wait(2500);
  const from = (c, sender) => c.received.filter((r) => r.m.user_id === sender.id && sentAt.has(r.m.body));
  const aGotB = from(A, B);
  const bGotA = from(B, A);
  const delays = [...aGotB, ...bGotA].map((r) => r.at - sentAt.get(r.m.body));
  check("A 가 B 메시지 5개 수신", aGotB.length === 5, `(${aGotB.length})`);
  check("B 가 A 메시지 5개 수신", bGotA.length === 5, `(${bGotA.length})`);
  check("전달 지연 2초 이내", delays.length > 0 && Math.max(...delays) < 2000, `(최대 ${Math.max(...delays)}ms)`);

  // 2. 공백 메시지 거부 (쓰기 정책 body ~ '\S')
  const empty = await send(A, "   \n  ");
  check("공백 메시지 거부", !!empty.error, `(${empty.error?.code})`);

  // 3. 같은 client_id 두 번 → 한 건만
  const dupId = randomUUID();
  const before = B.received.length;
  const r1 = await send(A, "중복 테스트", dupId);
  const r2 = await send(A, "중복 테스트", dupId);
  await wait(1500);
  const { count } = await A.sb.from("messages").select("*", { count: "exact", head: true }).eq("client_id", dupId);
  check("같은 client_id 는 한 번만 저장", r1.data?.length === 1 && r2.data?.length === 0 && count === 1,
    `(저장 ${count}건, 실시간 ${B.received.length - before}회)`);

  // 4. 재접속 동기화: 마지막 id 이후만
  const lastSeen = Math.max(...B.received.map((r) => r.m.id));
  await B.sb.removeChannel(B.channel);
  await send(A, "B 없을 때 1");
  await send(A, "B 없을 때 2");
  const { data: missed } = await B.sb.from("messages").select("body").eq("channel_id", made.channel).gt("id", lastSeen).order("id");
  const bodies = (missed ?? []).map((m) => m.body);
  check("재접속 후 놓친 메시지만 받음", bodies.length === 2 && bodies[0] === "B 없을 때 1", `(${JSON.stringify(bodies)})`);

  // 5. 위조 불가 (작성자·created_at 은 쓰기 권한이 없다), 남의 글은 못 지운다 (지우기 = 본인만 deleted_at)
  const forged = await A.sb.from("messages").insert({ client_id: randomUUID(), channel_id: made.channel, body: "위조", created_at: "2000-01-01" });
  check("created_at 위조 거부", !!forged.error, `(${forged.error?.code})`);
  const asB = await A.sb.from("messages").insert({ client_id: randomUUID(), channel_id: made.channel, body: "B 인 척", user_id: B.id });
  check("다른 사람 이름(user_id)으로 쓰기 거부", !!asB.error, `(${asB.error?.code})`);
  const hard = await A.sb.from("messages").delete().eq("channel_id", made.channel).select();
  check("메시지를 영구 삭제할 수 없다", !!hard.error || (hard.data ?? []).length === 0, `(${hard.error?.code ?? "0건"})`);
  const soft = await B.sb.from("messages").update({ deleted_at: new Date().toISOString() }).eq("channel_id", made.channel).eq("user_id", A.id).select();
  check("남의 메시지는 지울 수 없다", (soft.data ?? []).length === 0, `(${soft.error?.code ?? `${(soft.data ?? []).length}건`})`);

  // 6. HTML 문자열은 원문 그대로 저장 (화면은 텍스트로 출력)
  const xss = await send(A, "<img src=x onerror=alert(1)>");
  check("HTML 문자열 원문 보존", xss.data?.[0]?.body === "<img src=x onerror=alert(1)>");

  // 7. 로그인하지 않으면 못 읽고 못 쓴다 (Step 1 임시 호환을 닫음)
  const anon = createClient(url, anonKey, noSession);
  const anonRead = await anon.from("messages").select("id").limit(1);
  const anonWrite = await anon.from("messages").insert({ client_id: randomUUID(), body: "익명" });
  check("익명은 메시지를 못 읽고 못 쓴다", (!!anonRead.error || (anonRead.data ?? []).length === 0) && !!anonWrite.error,
    `(${anonRead.error?.code ?? `${anonRead.data?.length}건`} / ${anonWrite.error?.code})`);

  await A.sb.removeChannel(A.channel);
} catch (e) {
  results.push(`FAIL  테스트 오류: ${e.message ?? JSON.stringify(e)}`);
} finally {
  const errors = [];
  if (made.channel) {
    const { error } = await admin.from("channels").delete().eq("id", made.channel);
    if (error) errors.push(error.message);
  }
  for (const id of made.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(error.message);
  }
  console.log(errors.length ? `정리 실패: ${errors.join(" / ")}` : `정리: 시험 채널(메시지 포함) 1개, 사용자 ${made.users.length}명`);
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
