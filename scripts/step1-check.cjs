// Step 1 통과 테스트 자동 확인 (A·B 두 클라이언트). 서버를 켠 뒤 `npm run check:step1`

const { io } = require("socket.io-client");
const { randomUUID } = require("node:crypto");

const URL = process.env.CHAT_URL ?? "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);

function client(nickname) {
  const s = io(URL, { auth: { nickname }, transports: ["websocket"], forceNew: true });
  s.received = [];
  s.on("message:new", (m) => s.received.push({ m, at: Date.now() }));
  return new Promise((res, rej) => {
    s.on("connect", () => res(s));
    s.on("connect_error", rej);
  });
}
const send = (s, body, clientId = randomUUID()) =>
  s.timeout(3000).emitWithAck("message:send", { clientId, body });

(async () => {
  // 0. 닉네임 없이 접속하면 거부
  const noName = await client("").then(() => "connected", (e) => e.message);
  check("닉네임 없으면 접속 거부", noName !== "connected", `(${noName})`);

  const A = await client("테스트A");
  const B = await client("테스트B");

  // 1. 각자 5개 전송 → 상대가 받는지, 지연
  const sentAt = new Map();
  for (let i = 1; i <= 5; i++) {
    for (const [s, who] of [[A, "A"], [B, "B"]]) {
      const body = `${who}-${i}`;
      sentAt.set(body, Date.now());
      await send(s, body);
    }
  }
  await wait(500);
  const aGotB = A.received.filter((r) => r.m.author === "테스트B").length;
  const bGotA = B.received.filter((r) => r.m.author === "테스트A").length;
  const delays = B.received.map((r) => r.at - sentAt.get(r.m.body)).filter((d) => !isNaN(d));
  check("A 가 B 메시지 5개 수신", aGotB === 5, `(${aGotB})`);
  check("B 가 A 메시지 5개 수신", bGotA === 5, `(${bGotA})`);
  check("전달 지연 2초 이내", Math.max(...delays) < 2000, `(최대 ${Math.max(...delays)}ms)`);

  // 2. 빈 메시지·공백 거부
  const empty = await send(A, "   \n  ");
  check("공백 메시지 거부", empty.ok === false, `(${empty.error})`);

  // 3. 같은 clientId 두 번 → 한 번만 저장·방송
  const dupId = randomUUID();
  const before = B.received.length;
  const r1 = await send(A, "중복 테스트", dupId);
  const r2 = await send(A, "중복 테스트", dupId);
  await wait(300);
  check("같은 clientId 는 한 번만 저장", r1.message.id === r2.message.id && B.received.length - before === 1,
    `(id ${r1.message.id}/${r2.message.id}, 방송 ${B.received.length - before}회)`);

  // 4. B 가 끊긴 동안 A 가 보낸 메시지를 재접속 sync 로 받는지
  const lastSeen = Math.max(...B.received.map((r) => r.m.id));
  B.disconnect();
  await send(A, "B 없을 때 1");
  await send(A, "B 없을 때 2");
  const B2 = await client("테스트B");
  const { bootId } = await B2.timeout(3000).emitWithAck("sync", { afterId: 0 });
  const synced = await B2.timeout(3000).emitWithAck("sync", { afterId: lastSeen, bootId });
  check("같은 서버면 reset 아님", synced.reset === false);
  const bodies = synced.messages.map((m) => m.body);
  check("재접속 후 놓친 메시지만 받음", bodies.length === 2 && bodies[0] === "B 없을 때 1",
    `(${JSON.stringify(bodies)})`);

  // 5. HTML 문자열은 그대로 저장 (화면은 텍스트로 출력)
  const xss = await send(A, "<img src=x onerror=alert(1)>");
  check("HTML 문자열 원문 보존", xss.message.body === "<img src=x onerror=alert(1)>");

  [A, B2].forEach((s) => s.disconnect());
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})().catch((e) => {
  console.error("테스트 오류:", e);
  process.exit(1);
});
