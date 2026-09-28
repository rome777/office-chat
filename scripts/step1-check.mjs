// Step 1 통과 테스트 자동 확인 (A·B 두 클라이언트, 원격 Supabase).
// 실행: npm run check:step1  (.env.local 의 Supabase 값을 쓴다)
// 끝나면 테스트가 만든 메시지를 service role 키로 지운다.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!url || !anonKey) {
  console.error("Supabase 환경 변수가 없습니다. npx vercel env pull .env.local 을 먼저 실행하세요.");
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
const createdIds = [];

async function client(label) {
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  const received = [];
  const channel = sb
    .channel(`check-${label}-${randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) =>
      received.push({ m: p.new, at: Date.now() }),
    );
  await new Promise((res, rej) =>
    channel.subscribe((s) => (s === "SUBSCRIBED" ? res() : s !== "CLOSED" && s !== "SUBSCRIBED" && rej(new Error(s)))),
  );
  return { sb, channel, received };
}

async function send(sb, author, body, clientId = randomUUID()) {
  createdIds.push(clientId);
  return sb
    .from("messages")
    .upsert({ client_id: clientId, author, body }, { onConflict: "client_id", ignoreDuplicates: true })
    .select();
}

try {
  const A = await client("A");
  const B = await client("B");
  await wait(500);

  // 1. 각자 5개 → 상대가 받는지, 지연
  const sentAt = new Map();
  for (let i = 1; i <= 5; i++) {
    for (const [c, who] of [[A, "테스트A"], [B, "테스트B"]]) {
      const body = `${who}-${i}-${randomUUID().slice(0, 4)}`;
      sentAt.set(body, Date.now());
      const { error } = await send(c.sb, who, body);
      if (error) throw error;
    }
  }
  await wait(2500);
  const mine = (c, who) => c.received.filter((r) => r.m.author === who && sentAt.has(r.m.body));
  const aGotB = mine(A, "테스트B");
  const bGotA = mine(B, "테스트A");
  const delays = [...aGotB, ...bGotA].map((r) => r.at - sentAt.get(r.m.body));
  check("A 가 B 메시지 5개 수신", aGotB.length === 5, `(${aGotB.length})`);
  check("B 가 A 메시지 5개 수신", bGotA.length === 5, `(${bGotA.length})`);
  check("전달 지연 2초 이내", delays.length > 0 && Math.max(...delays) < 2000, `(최대 ${Math.max(...delays)}ms)`);

  // 2. 공백 메시지 거부 (DB 제약)
  const empty = await send(A.sb, "테스트A", "   \n  ");
  check("공백 메시지 거부", empty.error?.code === "23514", `(${empty.error?.code})`);

  // 3. 같은 client_id 두 번 → 한 건만
  const dupId = randomUUID();
  const before = B.received.length;
  const r1 = await send(A.sb, "테스트A", "중복 테스트", dupId);
  const r2 = await send(A.sb, "테스트A", "중복 테스트", dupId);
  await wait(1500);
  const { count } = await A.sb.from("messages").select("*", { count: "exact", head: true }).eq("client_id", dupId);
  check("같은 client_id 는 한 번만 저장", r1.data?.length === 1 && r2.data?.length === 0 && count === 1,
    `(저장 ${count}건, 실시간 ${B.received.length - before}회)`);

  // 4. 재접속 동기화: 마지막 id 이후만
  const lastSeen = Math.max(...B.received.map((r) => r.m.id));
  await B.sb.removeChannel(B.channel);
  await send(A.sb, "테스트A", "B 없을 때 1");
  await send(A.sb, "테스트A", "B 없을 때 2");
  const { data: missed } = await B.sb.from("messages").select("body").gt("id", lastSeen).order("id");
  const bodies = (missed ?? []).map((m) => m.body);
  check("재접속 후 놓친 메시지만 받음", bodies.length === 2 && bodies[0] === "B 없을 때 1", `(${JSON.stringify(bodies)})`);

  // 5. id·created_at 위조 불가, 삭제 불가
  const forged = await A.sb.from("messages").insert({ client_id: randomUUID(), author: "테스트A", body: "위조", created_at: "2000-01-01" });
  check("created_at 위조 거부", !!forged.error, `(${forged.error?.code})`);
  const del = await A.sb.from("messages").delete().eq("author", "테스트A").select();
  check("익명 삭제 불가", (del.data ?? []).length === 0, `(${del.error?.code ?? "0건"})`);

  // 6. HTML 문자열은 원문 그대로 저장 (화면은 텍스트로 출력)
  const xss = await send(A.sb, "테스트A", "<img src=x onerror=alert(1)>");
  check("HTML 문자열 원문 보존", xss.data?.[0]?.body === "<img src=x onerror=alert(1)>");

  await A.sb.removeChannel(A.channel);
} catch (e) {
  results.push(`FAIL  테스트 오류: ${e.message ?? e}`);
} finally {
  if (serviceKey) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { error } = await admin.from("messages").delete().in("client_id", createdIds);
    console.log(error ? `정리 실패: ${error.message}` : `테스트 메시지 ${createdIds.length}건 정리`);
  } else {
    console.log("service role 키가 없어 테스트 메시지를 지우지 못했습니다.");
  }
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
