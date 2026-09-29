// 1만 건 채널 만들기·측정·지우기 (페이지네이션·1만 건 측정 작업, TECH_SPEC 7절).
//   npm run seed:10k               채널 "1만건-측정"과 측정봇을 만들고 메시지 1만 건을 넣는다 (이미 있으면 건너뛴다)
//   npm run seed:10k -- --measure  측정봇 권한(RLS 적용)으로 조회·검색 시간을 잰다
//   npm run seed:10k -- --delete   채널(메시지는 함께 지워진다)과 측정봇을 지운다
//
// 원격 DB 를 팀 전체와 운영 배포가 같이 쓴다. 전용 채널에만 넣고, 다 쓰면 --delete 로 지운다.
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

const CHANNEL_NAME = "1만건-측정";
const BOT_EMAIL = "seed-10k-bot@example.com";
const TOTAL = 10_000;
const BATCH = 1000; // Supabase 한 번 요청 상한
const PAGE = 50;
const RUNS = 5;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, noSession);
const mode = process.argv.includes("--delete") ? "delete" : process.argv.includes("--measure") ? "measure" : "seed";

async function findBot() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === BOT_EMAIL) ?? null;
}
async function findChannel() {
  const { data } = await admin.from("channels").select("id").eq("name", CHANNEL_NAME).eq("type", "public").maybeSingle();
  return data?.id ?? null;
}

// 검색 시험용으로 흔한 업무 낱말을 섞는다. "회의록" 은 약 1% 에만 들어간다
const WORDS = ["배포", "일정", "검토", "요청", "확인", "공유", "수정", "테스트", "디자인", "보고서", "고객", "예산", "점심", "주간", "문서"];
function body(i) {
  const pick = (n) => WORDS[(i * 7 + n * 13) % WORDS.length];
  const extra = i % 97 === 0 ? " 회의록 올렸습니다" : "";
  return `[측정 ${i + 1}] ${pick(1)} ${pick(2)} 관련해서 ${pick(3)} 부탁드립니다${extra}`;
}

async function seed() {
  let bot = await findBot();
  if (!bot) {
    const { data, error } = await admin.auth.admin.createUser({
      email: BOT_EMAIL,
      email_confirm: true,
      user_metadata: { handle: "seedbot", display_name: "측정봇", department: "시스템" },
    });
    if (error) throw error;
    bot = data.user;
  }
  let channel = await findChannel();
  if (!channel) {
    const { data, error } = await admin.from("channels").insert({ name: CHANNEL_NAME, type: "public", created_by: bot.id }).select("id").single();
    if (error) throw error;
    channel = data.id;
    // 서버 작업이라 만든 사람 자동 가입 트리거가 있지만, 확실히 넣어 둔다
    await admin.from("memberships").upsert({ channel_id: channel, user_id: bot.id }, { onConflict: "channel_id,user_id" });
  }
  const { count } = await admin.from("messages").select("*", { count: "exact", head: true }).eq("channel_id", channel);
  if ((count ?? 0) >= TOTAL) {
    console.log(`이미 ${count}건이 있습니다 (채널 ${channel}). 측정: npm run seed:10k -- --measure`);
    return;
  }
  const started = Date.now();
  for (let from = count ?? 0; from < TOTAL; from += BATCH) {
    const rows = [];
    for (let i = from; i < Math.min(from + BATCH, TOTAL); i++) {
      rows.push({ client_id: randomUUID(), channel_id: channel, user_id: bot.id, body: body(i) });
    }
    const { error } = await admin.from("messages").insert(rows);
    if (error) throw error;
    process.stdout.write(`\r${Math.min(from + BATCH, TOTAL)} / ${TOTAL}`);
  }
  console.log(`\n넣었습니다: ${TOTAL - (count ?? 0)}건, ${((Date.now() - started) / 1000).toFixed(1)}초 (채널 ${channel})`);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function measure() {
  const bot = await findBot();
  const channel = await findChannel();
  if (!bot || !channel) throw new Error("먼저 npm run seed:10k 로 채널을 만드세요");
  // 측정봇으로 로그인해서 잰다 (비밀번호 없이 일회용 토큰) → 화면과 같이 RLS 가 걸린다
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: BOT_EMAIL });
  const sb = createClient(url, anonKey, noSession);
  const { error: loginError } = await sb.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (loginError) throw loginError;

  const { count } = await admin.from("messages").select("*", { count: "exact", head: true }).eq("channel_id", channel);
  const top = () => sb.from("messages").select("*").eq("channel_id", channel).is("parent_id", null).order("id", { ascending: false }).limit(PAGE);
  const first = await top();
  const cursor = first.data[Math.floor(PAGE / 2)].id - 5000; // 한가운데쯤
  const cases = [
    ["첫 조회 (최근 50건)", top],
    ["이전 페이지 (id < 커서, 50건)", () => sb.from("messages").select("*").eq("channel_id", channel).is("parent_id", null).lt("id", cursor).order("id", { ascending: false }).limit(PAGE)],
    ["검색: 이 채널에서 '회의록'", () => sb.from("messages").select("id").eq("channel_id", channel).ilike("body", "%회의록%").order("id", { ascending: false }).limit(PAGE)],
    ["검색: 내가 멤버인 전체에서 '회의록'", () => sb.from("messages").select("id").ilike("body", "%회의록%").order("id", { ascending: false }).limit(PAGE)],
  ];

  console.log(`측정 (${new Date().toISOString().slice(0, 10)}, 이 PC → 원격 Supabase 서울, 채널 ${count}건, ${RUNS}회 가운데값)`);
  for (const [name, run] of cases) {
    await run(); // 연결을 데워 둔다
    const times = [];
    let rows = 0;
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      const { data, error } = await run();
      times.push(performance.now() - t);
      if (error) throw error;
      rows = data.length;
    }
    console.log(`  ${name.padEnd(28)} ${median(times).toFixed(0).padStart(5)}ms  (받은 행 ${rows})`);
  }
  await sb.auth.signOut();
}

async function remove() {
  const channel = await findChannel();
  if (channel) {
    const { error } = await admin.from("channels").delete().eq("id", channel);
    if (error) throw error;
  }
  const bot = await findBot();
  if (bot) await admin.auth.admin.deleteUser(bot.id);
  console.log(`지웠습니다: 채널 ${channel ? 1 : 0}개, 측정봇 ${bot ? 1 : 0}명`);
}

await { seed, measure, delete: remove }[mode]();
