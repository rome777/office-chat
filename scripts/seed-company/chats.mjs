// 샘플 대화 읽기·검사. 대화 원본은 chats/*.mjs 에 채널별로 있고, 여기서 한 줄씩 펼쳐 넣을 모양으로 바꾼다.
// DB 없이 검사만: node scripts/seed-company/chats.mjs            (오류가 있으면 종료 코드 1)
//            채널 멤버 보기: node scripts/seed-company/chats.mjs --members
//
// ── 대화 파일 모양 ──────────────────────────────────────────
// export default [
//   {
//     channel: "backend",          // 부서 key (roster.mjs 의 UNITS), "project:<n>", "dm:<handle>:<handle>"
//     days: [
//       {
//         date: "2026-09-01",      // 평일만 (주말·추석 연휴 9/24~26 은 안 된다). 채널 안에서 날짜 순
//         lines: [
//           // [시각 "HH:MM", 쓴 사람 handle, 본문, 옵션?]  — 하루 안에서 시각 순
//           ["09:12", "jhyoon", "본문", {
//             react: { "👍": ["dhkim", "sylee"] },   // 리액션: 이모지 → 누른 사람들 (그 채널 멤버, 쓴 사람 말고)
//             pin: true,                             // 고정 (고정한 사람 = 쓴 사람). 다른 사람이면 pin: "handle"
//             replies: [                             // 스레드 답글: [시각, handle, 본문, { react }?]
//               ["09:20", "dhkim", "답글"],           // 시각은 "HH:MM"(같은 날) 또는 "2026-09-02 09:10"
//             ],
//           }],
//         ],
//       },
//     ],
//   },
// ];
// 멘션: @handle (그 채널 멤버만). 모두 멘션은 @{all}, 부서 멘션은 @{org:backend} 처럼 쓰면 저장 글자로 바꾼다.
// 메시지 id(client_id)는 채널·날짜·줄 번호로 정해진다 — 본문을 고쳐도 같은 id, 줄을 끼워 넣으면 그 뒤 줄의 id 가 바뀐다.
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { UNITS, PEOPLE, PROJECTS } from "./roster.mjs";

export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👏", "🎉", "👌", "✅", "🙏"];
/** 쉬는 날 (주말 말고). 2026 추석 연휴 */
const HOLIDAYS = new Set(["2026-09-24", "2026-09-25", "2026-09-26"]);

export const unitId = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** 시드 메시지의 client_id 는 모두 0c000000- 로 시작한다 (--reset-chats 가 이 범위만 지운다). 8001 은 채널·날짜·줄로 만든 것 */
export const SEED_MESSAGE_RANGE = ["0c000000-0000-0000-0000-000000000000", "0c000000-ffff-ffff-ffff-ffffffffffff"];
const clientId = (key) => `0c000000-0000-4000-8001-${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;

const handles = new Set(PEOPLE.map((p) => p.handle));

/** 조직 key → 그 조직과 모든 하위 조직 소속 handle */
export function unitMembers(key) {
  const keys = new Set([key]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const u of UNITS) if (u.parent && keys.has(u.parent) && !keys.has(u.key)) (keys.add(u.key), (grew = true));
  }
  return PEOPLE.filter((p) => keys.has(p.unit)).map((p) => p.handle);
}

/** 채널 key → 멤버 handle 목록. 없는 채널이면 null */
/** 공지 채널이면 새 글(최상위 메시지)을 쓸 수 있는 사람 — 담당 부서·리더·부리더 (DB 트리거와 같은 규칙). 아니면 null */
export function noticePosters(key) {
  const pj = /^project:(\d+)$/.exec(key);
  const p = pj && PROJECTS.find((x) => x.n === Number(pj[1]));
  if (!p?.notice) return null;
  return new Set([...unitMembers(p.notice), p.owner, ...(p.subs ?? [])]);
}

export function channelMembers(key) {
  if (UNITS.some((u) => u.key === key)) return unitMembers(key);
  const pj = /^project:(\d+)$/.exec(key);
  if (pj) {
    const p = PROJECTS.find((x) => x.n === Number(pj[1]));
    if (!p) return null;
    return p.members === "all" ? PEOPLE.map((x) => x.handle) : [p.owner, ...p.members];
  }
  const dm = /^dm:([^:]+):([^:]+)$/.exec(key);
  if (dm && dm[1] !== dm[2] && handles.has(dm[1]) && handles.has(dm[2])) return [dm[1], dm[2]];
  return null;
}

const pad = (n) => String(n).padStart(2, "0");
/** 한국 시각 → Date. 초는 key 로 정한다 (같은 분에 몰려도 자연스럽게) */
function kst(date, hhmm, key) {
  const sec = parseInt(createHash("sha1").update(key).digest("hex").slice(0, 4), 16) % 60;
  return new Date(`${date}T${hhmm}:${pad(sec)}+09:00`);
}

/** 본문의 자리표시(@{all}, @{org:key})를 DB 에 저장하는 글자로 바꾼다 */
function expandBody(body, err) {
  return body
    .replace(/@\{all\}/g, "@all-members-in-channel")
    .replace(/@\{org:([A-Za-z]+)\}/g, (_, k) => {
      const u = UNITS.find((x) => x.key === k);
      if (!u) err(`없는 부서 멘션 @{org:${k}}`);
      return u ? `@org-${unitId(u.n)}` : "";
    });
}

/**
 * 대화 파일을 모두 읽어 펼친다.
 * 돌려주는 값: { messages, errors, channels } — messages 는 시각 순이 아닌 파일 순, 답글은 parentKey 를 가진다
 */
export async function loadChats() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "chats");
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();
  const errors = [];
  const messages = [];
  const seenChannel = new Map();

  for (const file of files) {
    let data;
    try {
      data = (await import(pathToFileURL(path.join(dir, file)).href)).default;
    } catch (e) {
      errors.push(`${file}: 읽지 못했습니다 — ${e.message}`);
      continue;
    }
    if (!Array.isArray(data)) {
      errors.push(`${file}: export default 가 배열이 아닙니다`);
      continue;
    }
    for (const ch of data) {
      const where0 = `${file} ${ch.channel}`;
      const members = channelMembers(ch.channel);
      if (!members) {
        errors.push(`${where0}: 없는 채널`);
        continue;
      }
      if (seenChannel.has(ch.channel)) errors.push(`${where0}: ${seenChannel.get(ch.channel)} 에도 있는 채널 (한 채널은 한 파일에만)`);
      seenChannel.set(ch.channel, file);
      const memberSet = new Set(members.map((h) => h.toLowerCase()));
      const posters = noticePosters(ch.channel);
      let last = 0;
      let lastDate = "";

      for (const day of ch.days ?? []) {
        const d = new Date(`${day.date}T12:00:00+09:00`);
        const where1 = `${where0} ${day.date}`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date ?? "") || isNaN(d)) {
          errors.push(`${where1}: 날짜 모양이 틀렸습니다 (YYYY-MM-DD)`);
          continue;
        }
        if (day.date <= lastDate) errors.push(`${where1}: 날짜가 앞 날짜보다 이르거나 같습니다 (하루는 한 번만, 날짜 순)`);
        lastDate = day.date;
        const wd = d.getUTCDay();
        if (wd === 0 || wd === 6 || HOLIDAYS.has(day.date)) errors.push(`${where1}: 주말·연휴입니다`);

        (day.lines ?? []).forEach((line, i) => {
          const where = `${where1} #${i + 1}`;
          const err = (m) => errors.push(`${where}: ${m}`);
          const [hhmm, handle, body, opts = {}] = line;
          const key = `${ch.channel}|${day.date}|${i}`;
          const msg = checkOne({ hhmm, handle, body, date: day.date, key, memberSet, err });
          if (!msg) return;
          if (posters && !posters.has(handle)) err(`공지 채널의 새 글은 담당 부서·리더·부리더만 씁니다 (${handle}) — 답글은 누구나`);
          if (msg.at.getTime() < last) err(`시각이 앞 줄보다 이릅니다 (${hhmm})`);
          last = msg.at.getTime();
          msg.react = checkReact(opts.react, handle, memberSet, err);
          if (opts.pin) {
            const by = opts.pin === true ? handle : opts.pin;
            if (!memberSet.has(String(by).toLowerCase())) err(`고정한 사람 ${by} 이 채널 멤버가 아닙니다`);
            msg.pin = by;
          }
          messages.push({ ...msg, channel: ch.channel });

          let lastReply = msg.at.getTime();
          (opts.replies ?? []).forEach((r, j) => {
            const [rt, rh, rb, ro = {}] = r;
            const rerr = (m) => errors.push(`${where} 답글 ${j + 1}: ${m}`);
            const [rdate, rhhmm] = rt?.includes(" ") ? rt.split(" ") : [day.date, rt];
            const reply = checkOne({ hhmm: rhhmm, handle: rh, body: rb, date: rdate, key: `${key}|r${j}`, memberSet, err: rerr });
            if (!reply) return;
            if (reply.at.getTime() < lastReply) rerr(`시각이 부모·앞 답글보다 이릅니다 (${rt})`);
            lastReply = reply.at.getTime();
            reply.react = checkReact(ro.react, rh, memberSet, rerr);
            messages.push({ ...reply, channel: ch.channel, parentKey: msg.clientId });
          });
        });
      }
    }
  }
  const ids = new Set();
  for (const m of messages) {
    if (ids.has(m.clientId)) errors.push(`client_id 가 겹칩니다: ${m.channel} ${m.body.slice(0, 20)}`);
    ids.add(m.clientId);
  }
  return { messages, errors, channels: [...seenChannel.keys()] };
}

function checkOne({ hhmm, handle, body, date, key, memberSet, err }) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm ?? "")) return err(`시각 모양이 틀렸습니다 (${hhmm})`), null;
  if (!handles.has(handle)) return err(`없는 사람 ${handle}`), null;
  if (!memberSet.has(handle.toLowerCase())) err(`${handle} 은 이 채널 멤버가 아닙니다`);
  if (typeof body !== "string" || !/\S/.test(body)) return err("본문이 비었습니다"), null;
  const stored = expandBody(body, err);
  if (stored.length > 2000) err(`본문이 2000자를 넘습니다 (${stored.length}자)`);
  // 멘션 검사 (DB 트리거와 같은 규칙: 앞이 글자가 아닌 @)
  for (const [, tok] of body.matchAll(/(?:^|[^\p{L}\p{N}_])@([A-Za-z0-9_가-힣-]+)/gu)) {
    if (!handles.has(tok)) err(`없는 사람 멘션 @${tok} (handle 뒤에 한글을 바로 붙이면 멘션이 안 된다. 모두는 @{all}, 부서는 @{org:key})`);
    else if (!memberSet.has(tok.toLowerCase())) err(`@${tok} 은 이 채널 멤버가 아니라 알림이 안 갑니다`);
    else if (tok === handle) err(`자기 자신 멘션 @${tok}`);
  }
  return { clientId: clientId(key), handle, body: stored, at: kst(date, hhmm, key) };
}

function checkReact(react, author, memberSet, err) {
  const out = [];
  for (const [emoji, who] of Object.entries(react ?? {})) {
    if (!REACTIONS.includes(emoji)) err(`쓸 수 없는 이모지 ${emoji} (${REACTIONS.join(" ")})`);
    for (const h of who) {
      if (!memberSet.has(String(h).toLowerCase())) err(`리액션한 ${h} 이 채널 멤버가 아닙니다`);
      if (h === author) err(`자기 글에 리액션 (${h})`);
      out.push({ emoji, handle: h });
    }
  }
  return out;
}

// 바로 실행하면 검사만 한다
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--members")) {
    const keys = [...UNITS.map((u) => u.key), ...PROJECTS.map((p) => `project:${p.n}`)];
    for (const k of keys) console.log(`${k}: ${channelMembers(k).join(", ")}`);
    process.exit(0);
  }
  const { messages, errors, channels } = await loadChats();
  const top = messages.filter((m) => !m.parentKey).length;
  const now = Date.now();
  const future = messages.filter((m) => m.at.getTime() > now).length;
  const per = {};
  for (const m of messages) per[m.channel] = (per[m.channel] ?? 0) + 1;
  console.log(Object.entries(per).map(([k, v]) => `${k} ${v}`).join(" · "));
  console.log(
    `채널 ${channels.length}개, 메시지 ${messages.length}건 (답글 ${messages.length - top}건), ` +
      `리액션 ${messages.reduce((s, m) => s + m.react.length, 0)}개, 고정 ${messages.filter((m) => m.pin).length}건` +
      (future ? `, 아직 오지 않은 시각 ${future}건 (넣을 때 건너뜀)` : ""),
  );
  if (errors.length) {
    console.error(`\n오류 ${errors.length}개:\n` + errors.join("\n"));
    process.exit(1);
  }
  console.log("오류 없음");
}
