// Step 1 임시 서버: Next.js 화면 + Socket.IO 실시간 채팅 (메모리 저장).
// 서버를 재시작하면 대화가 사라진다. Step 2 에서 Supabase 로 바꾼다.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";

const dev = !process.argv.includes("--prod");
const port = Number(process.env.PORT ?? 3000);

const MAX_BODY = 2000;
const MAX_NICKNAME = 20;
const KEEP_MESSAGES = 500;
const INITIAL_HISTORY = 50;

const app = next({ dev });
const handler = app.getRequestHandler();
await app.prepare();

const httpServer = createServer(handler);
const io = new Server(httpServer);

/** @type {{ id: number, clientId: string, author: string, body: string, createdAt: string }[]} */
const messages = [];
/** 멱등 전송: 같은 clientId 는 한 번만 저장한다 */
const byClientId = new Map();
let lastId = 0;
// 재시작하면 id 가 1부터 다시 시작한다. 클라이언트가 이 값으로 재시작을 알아채고 화면을 비운다.
const BOOT_ID = randomUUID();

function broadcastPresence() {
  io.emit("presence", { online: io.of("/").sockets.size });
}

io.use((socket, nextFn) => {
  const nickname = String(socket.handshake.auth?.nickname ?? "").trim();
  if (!nickname || nickname.length > MAX_NICKNAME) {
    return nextFn(new Error("닉네임은 1~20자여야 합니다"));
  }
  socket.data.nickname = nickname;
  nextFn();
});

io.on("connection", (socket) => {
  broadcastPresence();

  // 재접속 동기화: 클라이언트가 마지막으로 받은 id 이후만 돌려준다
  socket.on("sync", ({ afterId, bootId } = {}, ack) => {
    if (typeof ack !== "function") return;
    const after = Number(afterId) || 0;
    const reset = bootId !== BOOT_ID;
    const missed =
      reset || after === 0 ? messages.slice(-INITIAL_HISTORY) : messages.filter((m) => m.id > after);
    ack({ bootId: BOOT_ID, reset, messages: missed });
  });

  socket.on("message:send", ({ clientId, body } = {}, ack) => {
    if (typeof ack !== "function") return;
    const text = String(body ?? "").trim();
    if (typeof clientId !== "string" || !clientId) {
      return ack({ ok: false, error: "잘못된 요청입니다" });
    }
    if (!text) return ack({ ok: false, error: "빈 메시지는 보낼 수 없습니다" });
    if (text.length > MAX_BODY) {
      return ack({ ok: false, error: `메시지는 ${MAX_BODY}자까지입니다` });
    }

    const existing = byClientId.get(clientId);
    if (existing) return ack({ ok: true, message: existing });

    const message = {
      id: ++lastId,
      clientId,
      author: socket.data.nickname,
      body: text,
      createdAt: new Date().toISOString(),
    };
    messages.push(message);
    byClientId.set(clientId, message);
    if (messages.length > KEEP_MESSAGES) {
      byClientId.delete(messages.shift().clientId);
    }

    io.emit("message:new", message);
    ack({ ok: true, message });
  });

  socket.on("disconnect", broadcastPresence);
});

httpServer.listen(port, () => {
  console.log(`> 오피스톡 Step 1 서버: http://localhost:${port} (${dev ? "dev" : "prod"})`);
});
