// 회사 시드 데이터. 가상 회사 "한결테크 주식회사" 의 조직(회사 → 사업부 → 본부 → 팀)과 직원 37명·프로필 사진·연락처,
// 부서 채널, 프로젝트 채널 4개와 공지 채널(#공지사항), DM, 9월 한 달치 대화(스레드·리액션·고정 메시지 포함),
// 회의실 8개와 9~10월 일정(반복 회의·업무 마감·외근·개인 일정·휴가)을 만든다. 운영 DB 에도 이것을 넣는다 (2026-09-29).
// 실행: .env.local 에 SEED_PASSWORD=<비밀번호 6자 이상> 을 넣고 npm run seed:company
//       대화를 지우고 처음부터 다시 넣기: npm run seed:company -- --reset-chats   (일정은 --reset-events, 둘 다 줘도 된다)
//       DB 없이 검사만: node scripts/seed-company/chats.mjs · node scripts/seed-company/schedule.mjs
//
// 데이터는 seed-company/ 에 있다: roster.mjs(조직·사람·프로젝트 채널) · chats/*.mjs(대화, 모양은 chats.mjs 머리말) ·
// schedule.mjs(회의실·일정) · avatars/(프로필 사진 — avatars.mjs 로 한 번 만들어 둔 파일, 비용이 들어 시드가 다시 만들지 않는다)
//
// 여러 번 돌려도 된다: 이 스크립트가 만든 계정(가입 정보 seed = "company")은 이름·소속·직급만 맞추고,
// 대화·일정은 없는 것만 넣는다. 비밀번호는 새로 만들 때만 정하고 다시 바꾸지 않는다.
// 이 스크립트가 만들지 않은 계정은 메일 주소가 겹쳐도 건드리지 않는다 (기존 계정은 그대로 둔다).
// 새 계정은 모두 SEED_PASSWORD 하나를 쓴다. 비밀번호는 저장소·문서에 쓰지 않는다.
//
// 메시지 순서는 id 로 정해진다 (시각이 아니다). 대화는 9월 과거 시각으로 넣으므로, 이미 있는 메시지보다 id 가 크면
// 화면에서 그 뒤에 나온다. 대화 파일에 줄을 더했거나 순서가 꼬였으면 --reset-chats 로 시드 메시지만 지우고 다시 넣는다
// (client_id 가 0c000000- 로 시작하는 것만 지운다. 사람이 쓴 메시지는 건드리지 않는다 — 시드 메시지에 단 답글은 함께 지워진다).
//
// 부서 채널은 DB 가 만든다 (supabase/migrations/20260929170000_org_units.sql):
//   조직을 넣으면 같은 이름의 비공개 채널이 생기고, 사람의 소속(profiles.org_unit_id)을 정하면
//   그 조직과 모든 상위 조직의 채널에 자동으로 들어간다. 회사 채널은 #일반 이다.
// 공지 채널은 notice_unit_id 를 정하면 DB 가 모든 사람을 넣는다 (20261001160000_notice_channel.sql) — 시드가 아닌 계정도 들어간다.
//
// 연락처(profile_contacts)도 모두 채운다: 010-0000-1001 부터 차례로 (0000 국번은 쓰지 않는 번호라 실제 번호와 겹치지 않는다).
// 이미 연락처가 있는 사람은 건드리지 않는다 (본인이 고친 번호를 지키려고). 연락처만 채우려면: npm run seed:company -- --contacts-only
// 프로필 사진도 같다: 이미 사진·캐릭터를 고른 사람은 그대로 둔다 (--avatars-overwrite 면 시드 사진으로 바꾼다).
//
// 실명·실제 사내 정보는 쓰지 않는다. 이름은 지어낸 것이고, example.com 은 예시용으로 예약된 도메인이라 실제 메일이 가지 않는다.
// 프로필 사진도 실존하지 않는 사람을 생성한 것이다.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { UNITS, PEOPLE, PROJECTS } from "./seed-company/roster.mjs";
import { loadChats, unitId, SEED_MESSAGE_RANGE } from "./seed-company/chats.mjs";
import { ROOMS, loadSchedule, SEED_EVENT_RANGE } from "./seed-company/schedule.mjs";
import { avatarFile } from "./seed-company/avatars.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const password = process.env.SEED_PASSWORD;
if (!url || !serviceKey) {
  console.error("Supabase 환경 변수가 없습니다. npx vercel env pull .env.local 을 먼저 실행하세요.");
  process.exit(1);
}
if (!password || password.length < 6) {
  console.error(".env.local 에 SEED_PASSWORD (6자 이상, Supabase 최소 길이) 를 넣어 주세요. 새로 만드는 계정이 모두 이 비밀번호를 씁니다.");
  process.exit(1);
}
/** 이 스크립트가 만든 계정 표시 (auth 가입 정보) */
const SEED_MARK = "company";
const RESET_CHATS = process.argv.includes("--reset-chats");
const RESET_EVENTS = process.argv.includes("--reset-events");
const OVERWRITE_AVATARS = process.argv.includes("--avatars-overwrite");
/** 이 시각보다 앞선 메시지·초대는 읽은 것으로 둔다 (그 뒤는 안 읽음·알림으로 남아 시연에 쓴다) */
const READ_UNTIL = new Date("2026-09-29T12:00:00+09:00");

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// 시드가 만드는 것의 id 는 고정한다 (다시 돌려도 같은 행을 찾게)
const channelId = (n) => `0b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ── 실행 ────────────────────────────────────────────────────

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
/** at 에서 몇 분 뒤 (지금보다 늦으면 지금) */
const later = (at, minutes) => new Date(Math.min(at.getTime() + minutes * 60_000, Date.now())).toISOString();
/** 범위 안의 행을 1000개씩 끝까지 읽는다 */
async function readAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** 회의실 (seed-company/schedule.mjs 의 ROOMS). 예전 이름(was)의 행이 있으면 이름을 바꿔 쓴다 — 그 방의 예약이 그대로 이어진다 */
async function seedRooms() {
<<<<<<< HEAD
  const byName = new Map(must(await admin.from("rooms").select("id, name")).map((r) => [r.name, r]));
  const out = new Map();
  for (const r of ROOMS) {
    const row = { name: r.name, capacity: r.capacity, location: r.location };
    const hit = byName.get(r.name) ?? (r.was ? byName.get(r.was) : undefined);
    const saved = hit
      ? must(await admin.from("rooms").update(row).eq("id", hit.id).select("id").single())
      : must(await admin.from("rooms").insert(row).select("id").single());
    out.set(r.name, saved.id);
  }
  return out;
=======
  // 원격(팀·운영 공용) DB 의 회의실 8개와 같다 — supabase/seed.sql · 마이그레이션 20261001180000_rooms_data (2026-10-01 층·시설·설명)
  must(
    await admin.from("rooms").upsert(
      [
        { name: "C1 상생", capacity: 30, location: "5층", facilities: ["projector", "video", "mic"], description: "대회의실 · 무선 마이크 2개 · 타운홀·행사", sort_order: 10 },
        { name: "C2 신뢰", capacity: 12, location: "5층", facilities: ["monitor", "video"], description: "보안 회의 · 임원·고객 미팅 우선", sort_order: 20 },
        { name: "C3 열정", capacity: 20, location: "3층", facilities: ["projector"], description: "교육실 · 노트북 대여 6대 · 교육·온보딩", sort_order: 30 },
        { name: "C4 이끔", capacity: 12, location: "6층", facilities: ["monitor", "video"], description: "85인치 TV · 스프린트·배포 상황실", sort_order: 40 },
        { name: "M1 확산", capacity: 8, location: "5층", facilities: ["video", "mic", "whiteboard"], description: "화상회의 카메라·스피커폰", sort_order: 50 },
        { name: "M2 공유", capacity: 4, location: "5층", facilities: ["monitor"], description: "C1 옆 · 55인치 TV·화면 공유", sort_order: 60 },
        { name: "M3 가치", capacity: 4, location: "6층", facilities: ["monitor", "whiteboard"], description: "소회의실 · 면접 가능", sort_order: 70 },
        { name: "M4 연구", capacity: 2, location: "6층", facilities: ["video"], description: "2인 화상회의 부스 · 방음 · 1:1 면담", sort_order: 80 },
      ],
      { onConflict: "name", ignoreDuplicates: true },
    ),
  );
>>>>>>> 7b972a0a2d3aebd31fe8032ac759cd9cd9ef9a66
}

/** 조직을 넣거나 맞춘다. upsert 는 쓰지 않는다 — 충돌해도 before insert 트리거가 채널을 먼저 만들어 버린다 */
async function seedUnits() {
  const existing = new Map(
    must(await admin.from("org_units").select("id, channel_id").in("id", UNITS.map((u) => unitId(u.n)))).map(
      (r) => [r.id, r],
    ),
  );
  const out = new Map();
  UNITS.forEach((u, i) => (u.sort = i));
  for (const u of UNITS) {
    const id = unitId(u.n);
    const row = {
      name: u.name,
      kind: u.kind,
      parent_id: u.parent ? unitId(UNITS.find((p) => p.key === u.parent).n) : null,
      sort_order: u.sort,
    };
    if (existing.has(id)) {
      must(await admin.from("org_units").update(row).eq("id", id));
      out.set(u.key, { id, channel_id: existing.get(id).channel_id });
    } else {
      const created = must(
        await admin
          .from("org_units")
          .insert({ id, ...row, ...(u.channel ? { channel_id: u.channel } : {}) })
          .select("id, channel_id")
          .single(),
      );
      out.set(u.key, created);
    }
  }
  return out;
}

async function seedPeople(units) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const byEmail = new Map(users.map((u) => [u.email?.toLowerCase(), u]));

  const ids = new Map();
  let created = 0;
  for (const p of PEOPLE) {
    const email = `${p.handle.toLowerCase()}@example.com`;
    const unitName = UNITS.find((u) => u.key === p.unit).name;
    const meta = { handle: p.handle, display_name: p.name, department: unitName, title: p.title, seed: SEED_MARK };
    const found = byEmail.get(email);
    let id;
    if (found) {
      if (found.user_metadata?.seed !== SEED_MARK) {
        throw new Error(`${email} 은 이 스크립트가 만든 계정이 아닙니다. 건드리지 않으려고 멈춥니다 — handle 을 바꿔 주세요`);
      }
      id = found.id; // 비밀번호·로그인 정보는 그대로 둔다
    } else {
      const data = must(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta }));
      id = data.user.id;
      created++;
    }
    // 소속을 정하면 트리거가 부서 채널에 넣는다 (handle 이 겹쳐 숫자가 붙었을 수 있어 다시 맞춘다)
    must(
      await admin
        .from("profiles")
        .update({
          handle: p.handle,
          display_name: p.name,
          department: unitName,
          title: p.title,
          org_unit_id: units.get(p.unit).id,
        })
        .eq("id", id),
    );
    ids.set(p.handle, id);
  }

  for (const p of PEOPLE.filter((p) => p.lead)) {
    must(await admin.from("org_units").update({ leader_id: ids.get(p.handle) }).eq("id", units.get(p.unit).id));
  }
  return { ids, created };
}

// 연락처가 없는 사람만 넣는다 (있으면 그대로 둔다). 회사 연락처라 공개로 넣는다
async function seedContacts(ids) {
  const existing = new Set(
    must(await admin.from("profile_contacts").select("user_id").in("user_id", [...ids.values()])).map((r) => r.user_id),
  );
  const rows = PEOPLE.map((p, i) => ({ user_id: ids.get(p.handle), phone: `010-0000-${1001 + i}`, is_public: true })).filter(
    (r) => r.user_id && !existing.has(r.user_id),
  );
  if (rows.length) must(await admin.from("profile_contacts").insert(rows));
  return rows.length;
}

/** 프로젝트 채널과 공지 채널. 공지 채널은 notice_unit_id 를 정하면 DB 가 모든 사람을 넣고, 부리더(subs)를 정한다 */
async function seedProjects(ids, units) {
  const out = new Map();
  for (const pj of PROJECTS) {
    const id = channelId(pj.n);
    const notice_unit_id = pj.notice ? units.get(pj.notice).id : null;
    const found = must(await admin.from("channels").select("id").eq("id", id));
    if (found.length === 0) {
      // 만든 사람은 트리거(channels_add_creator)가 멤버·리더로 넣는다
      must(
        await admin.from("channels").insert({
          id,
          name: pj.name,
          type: pj.type,
          description: pj.description,
          created_by: ids.get(pj.owner),
          ...(notice_unit_id ? { notice_unit_id } : {}),
        }),
      );
    } else {
      must(await admin.from("channels").update({ description: pj.description, notice_unit_id }).eq("id", id));
    }
    const members = pj.members === "all" ? [...ids.keys()] : [pj.owner, ...pj.members];
    must(
      await admin.from("memberships").upsert(
        members.map((h) => ({ channel_id: id, user_id: ids.get(h) })),
        { onConflict: "channel_id,user_id", ignoreDuplicates: true },
      ),
    );
    for (const h of pj.subs ?? []) {
      must(
        await admin
          .from("memberships")
          .update({ role: "sub", role_at: new Date().toISOString() })
          .eq("channel_id", id)
          .eq("user_id", ids.get(h))
          .eq("role", "member"),
      );
    }
    out.set(pj.n, id);
  }
  return out;
}

/** DM 채널: 대화 파일에 나오는 짝마다 하나. create_dm() 과 같은 dm_key(두 id 를 정렬해 이은 값)로 찾거나 만든다 */
async function seedDMs(ids, channelKeys) {
  const out = new Map();
  for (const key of channelKeys.filter((k) => k.startsWith("dm:"))) {
    const [, a, b] = key.split(":");
    const [x, y] = [ids.get(a), ids.get(b)].sort();
    const dm_key = `${x}:${y}`;
    let row = must(await admin.from("channels").select("id").eq("dm_key", dm_key)).at(0);
    if (!row) row = must(await admin.from("channels").insert({ type: "dm", dm_key, created_by: ids.get(a) }).select("id").single());
    must(
      await admin
        .from("memberships")
        .upsert([a, b].map((h) => ({ channel_id: row.id, user_id: ids.get(h) })), { onConflict: "channel_id,user_id", ignoreDuplicates: true }),
    );
    out.set(key, row.id);
  }
  return out;
}

/**
 * 샘플 대화 (seed-company/chats/*.mjs). client_id 가 고정이라 다시 돌려도 없는 것만 들어간다.
 * 순서는 id 로 정해지므로 최상위 메시지를 모든 채널에 걸쳐 시각 순으로 먼저 넣고, 답글을 시각 순으로 그다음에 넣는다.
 * 그 뒤 리액션·고정, 읽음 위치, 알림 시각·읽음을 맞춘다
 */
async function seedChats(chats, ids, units, projects, dms) {
  const channelOf = (key) => {
    if (key.startsWith("dm:")) return dms.get(key);
    if (key.startsWith("project:")) return projects.get(Number(key.slice(8)));
    return units.get(key).channel_id;
  };
  let removed = 0;
  if (RESET_CHATS) {
    const rows = must(
      await admin.from("messages").delete().gte("client_id", SEED_MESSAGE_RANGE[0]).lte("client_id", SEED_MESSAGE_RANGE[1]).select("id"),
    );
    removed = rows.length; // 답글·알림·리액션·고정은 cascade 로 같이 지워진다
  }

  const now = Date.now();
  const all = chats.filter((m) => m.at.getTime() <= now);
  const existing = new Map(
    (
      await readAll(() =>
        admin
          .from("messages")
          .select("id, client_id, channel_id")
          .gte("client_id", SEED_MESSAGE_RANGE[0])
          .lte("client_id", SEED_MESSAGE_RANGE[1])
          .order("id"),
      )
    ).map((r) => [r.client_id, r]),
  );
  const byTime = (p, q) => p.at - q.at;
  const toRow = (m, parent_id = null) => ({
    client_id: m.clientId,
    channel_id: channelOf(m.channel),
    user_id: ids.get(m.handle),
    parent_id,
    body: m.body,
    created_at: m.at.toISOString(),
  });

  // 최상위·답글을 모두 시각 순으로 넣는다 → id 도 시각 순 (읽음 위치·안 읽은 사람 수가 id 로 계산된다).
  // 답글은 부모 id 가 있어야 하므로, 부모가 아직 안 넣은 묶음에 있으면 그 묶음을 먼저 넣는다
  let inserted = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const rows = batch.map(({ m }) => toRow(m, m.parentKey ? existing.get(m.parentKey).id : null));
    batch = [];
    const got = must(
      await admin.from("messages").upsert(rows, { onConflict: "client_id", ignoreDuplicates: true }).select("id, client_id, channel_id"),
    );
    for (const r of got) existing.set(r.client_id, r);
    inserted += got.length;
  };
  for (const m of all.filter((x) => !existing.has(x.clientId)).sort(byTime)) {
    if (m.parentKey && !existing.has(m.parentKey)) await flush();
    if (m.parentKey && !existing.has(m.parentKey)) continue; // 부모가 없다 (파일에서 빠짐)
    batch.push({ m });
    if (batch.length >= 300) await flush();
  }
  await flush();

  // 리액션·고정 (이미 있으면 그대로)
  const reactions = all.flatMap((m) =>
    m.react.map((r, i) => ({
      message_id: existing.get(m.clientId).id,
      user_id: ids.get(r.handle),
      emoji: r.emoji,
      channel_id: channelOf(m.channel),
      created_at: later(m.at, 1 + ((i * 7) % 40)),
    })),
  );
  for (const part of chunks(reactions, 500)) {
    must(await admin.from("message_reactions").upsert(part, { onConflict: "message_id,user_id,emoji", ignoreDuplicates: true }));
  }
  const pins = all
    .filter((m) => m.pin)
    .map((m) => ({
      message_id: existing.get(m.clientId).id,
      channel_id: channelOf(m.channel),
      pinned_by: ids.get(m.pin),
      pinned_at: later(m.at, 3),
    }));
  if (pins.length) must(await admin.from("pinned_messages").upsert(pins, { onConflict: "message_id", ignoreDuplicates: true }));

  // 읽음 위치: 시드 멤버마다, 그 채널에서 READ_UNTIL 전 마지막 메시지와 자기가 마지막으로 쓴 메시지 가운데 큰 쪽까지.
  // 시드가 아닌 계정의 읽음 위치는 건드리지 않는다. 뒤로 가는 값은 read_positions_forward 트리거가 막는다
  const lastBefore = new Map(); // channel_id → id
  const lastOwn = new Map(); // `${channel_id}|${user_id}` → id
  for (const m of all) {
    const row = existing.get(m.clientId);
    if (m.at < READ_UNTIL) lastBefore.set(row.channel_id, Math.max(lastBefore.get(row.channel_id) ?? 0, row.id));
    const k = `${row.channel_id}|${ids.get(m.handle)}`;
    lastOwn.set(k, Math.max(lastOwn.get(k) ?? 0, row.id));
  }
  const seedUsers = new Set(ids.values());
  const channelIds = [...new Set(all.map((m) => channelOf(m.channel)))];
  const members = must(await admin.from("memberships").select("channel_id, user_id").in("channel_id", channelIds)).filter((r) =>
    seedUsers.has(r.user_id),
  );
  const positions = members
    .map((r) => ({
      channel_id: r.channel_id,
      user_id: r.user_id,
      last_read_message_id: Math.max(lastBefore.get(r.channel_id) ?? 0, lastOwn.get(`${r.channel_id}|${r.user_id}`) ?? 0),
    }))
    .filter((r) => r.last_read_message_id > 0);
  for (const part of chunks(positions, 500)) {
    must(await admin.from("read_positions").upsert(part, { onConflict: "channel_id,user_id" }));
  }

  // 알림: 트리거가 넣은 시각(지금)을 메시지 시각으로 바꾸고, 읽음 위치 안쪽 것은 읽음으로 둔다
  const readPos = new Map(positions.map((r) => [`${r.channel_id}|${r.user_id}`, r.last_read_message_id]));
  const atById = new Map(all.map((m) => [existing.get(m.clientId).id, m.at]));
  const notes = [];
  for (const part of chunks([...atById.keys()], 200)) {
    notes.push(
      ...(await readAll(() =>
        admin.from("notifications").select("id, user_id, channel_id, message_id, read_at").in("message_id", part).order("id"),
      )),
    );
  }
  const groups = new Map(); // `${message_id}|${읽음}` → 알림 id 들 (같은 값으로 바꿀 것끼리 한 번에)
  for (const n of notes) {
    const read = n.read_at != null || n.message_id <= (readPos.get(`${n.channel_id}|${n.user_id}`) ?? 0);
    const k = `${n.message_id}|${read}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n.id);
  }
  const jobs = [...groups].map(([k, nids]) => async () => {
    const [messageId, read] = k.split("|");
    const at = atById.get(Number(messageId));
    const patch = { created_at: at.toISOString(), ...(read === "true" ? { read_at: later(at, 30) } : {}) };
    must(await admin.from("notifications").update(patch).in("id", nids));
  });
  for (const part of chunks(jobs, 20)) await Promise.all(part.map((j) => j()));

  return { removed, inserted, reactions: reactions.length, pins: pins.length, notes: notes.length };
}

/**
 * 일정 (seed-company/schedule.mjs). id 가 고정이라 다시 돌려도 없는 것만 들어간다 (--reset-events 면 시드 일정을 지우고 다시).
 * 회의실이 시드 밖의 예약과 겹치면 그 회차만 회의실 없이 넣는다. 초대 알림은 일정을 만든 시각으로 맞추고,
 * READ_UNTIL 전에 만들었거나 이미 지난 일정의 초대는 읽음으로 둔다
 */
async function seedEvents(events, ids, rooms, projects) {
  let removed = 0;
  if (RESET_EVENTS) {
    // 예전 시드의 샘플 회의(0e000000-0000-4000-8000-000000000001)도 이 범위라 같이 지워진다. 참석자·알림은 cascade
    removed = must(await admin.from("events").delete().gte("id", SEED_EVENT_RANGE[0]).lte("id", SEED_EVENT_RANGE[1]).select("id")).length;
  }
  const existing = new Set(
    (await readAll(() => admin.from("events").select("id").gte("id", SEED_EVENT_RANGE[0]).lte("id", SEED_EVENT_RANGE[1]).order("id"))).map(
      (r) => r.id,
    ),
  );
  const toRow = (e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    starts_at: e.starts.toISOString(),
    ends_at: e.ends.toISOString(),
    room_id: e.room ? rooms.get(e.room) : null,
    created_by: ids.get(e.by),
    created_at: e.created.toISOString(),
    updated_at: e.created.toISOString(),
    canceled_at: e.canceled ? later(new Date(Math.max(e.created.getTime(), e.starts.getTime() - 2 * 86400e3)), 0) : null,
    kind: e.kind,
    subtype: e.subtype,
    all_day: e.allDay,
    location: e.location,
    visibility: e.visibility,
    channel_id: e.channel ? projects.get(Number(e.channel.slice(8))) : null,
    series_id: e.seriesId,
    recurrence: e.recurrence,
  });
  const fresh = events.filter((e) => !existing.has(e.id));
  const noRoom = [];
  for (const part of chunks(fresh.map(toRow), 100)) {
    const { error } = await admin.from("events").insert(part);
    if (!error) continue;
    if (error.code !== "23P01") throw error;
    // 시드 밖의 예약과 겹친 행이 있다 → 하나씩 넣고, 겹치는 행은 회의실 없이
    for (const row of part) {
      let { error: one } = await admin.from("events").insert(row);
      if (one?.code === "23P01") {
        noRoom.push(`${row.title} ${row.starts_at.slice(0, 10)}`);
        ({ error: one } = await admin.from("events").insert({ ...row, room_id: null }));
      }
      if (one && one.code !== "23505") throw one;
    }
  }
  // 참석자 (이미 있으면 그대로). 여러 행을 한 번에 넣으므로 모든 행에 모든 칸을 적는다
  const attendees = events.flatMap((e) =>
    e.attendees.map((a) => ({
      event_id: e.id,
      user_id: ids.get(a.handle),
      response: a.response,
      responded_at: a.responded ? a.responded.toISOString() : null,
      remind_minutes: a.remind,
    })),
  );
  for (const part of chunks(attendees, 500)) {
    must(await admin.from("event_attendees").upsert(part, { onConflict: "event_id,user_id", ignoreDuplicates: true }));
  }
  // 초대 알림: 만든 시각으로, 오래된 것은 읽음으로
  const byId = new Map(events.map((e) => [e.id, e]));
  const jobs = events.map((e) => async () => {
    const read = e.created < READ_UNTIL || e.starts.getTime() < Date.now();
    must(
      await admin
        .from("notifications")
        .update({ created_at: e.created.toISOString(), ...(read ? { read_at: later(e.created, 60) } : {}) })
        .eq("event_id", e.id)
        .eq("type", "event_invite"),
    );
  });
  for (const part of chunks(jobs, 20)) await Promise.all(part.map((j) => j()));
  return { removed, inserted: fresh.length, attendees: attendees.length, noRoom, series: new Set(fresh.map((e) => e.seriesId).filter(Boolean)).size, byId };
}

<<<<<<< HEAD
/**
 * 프로필 사진 (seed-company/avatars/<handle>.webp). avatars 버킷 <user id>/seed-<내용 해시>.webp 에 올리고 profiles.avatar 를 정한다.
 * 이미 사진·캐릭터를 고른 사람은 그대로 둔다 (--avatars-overwrite 면 바꾼다). 시드 사진이 바뀌면 옛 파일은 지운다
 */
async function seedAvatars(ids) {
  const current = new Map(must(await admin.from("profiles").select("id, avatar").in("id", [...ids.values()])).map((r) => [r.id, r.avatar]));
  let set = 0;
  const kept = [];
  const missing = [];
  for (const [handle, id] of ids) {
    const file = avatarFile(handle);
    if (!existsSync(file)) {
      missing.push(handle);
      continue;
    }
    const image = readFileSync(file);
    const path = `${id}/seed-${createHash("sha1").update(image).digest("hex").slice(0, 10)}.webp`;
    const now = current.get(id);
    if (now === `photo:${path}`) continue;
    const seedPhoto = now?.startsWith(`photo:${id}/seed-`);
    if (now && !seedPhoto && !OVERWRITE_AVATARS) {
      kept.push(handle);
      continue;
    }
    const storage = admin.storage.from("avatars");
    const { error } = await storage.upload(path, image, { contentType: "image/webp", cacheControl: "31536000", upsert: true });
    if (error) throw error;
    must(await admin.from("profiles").update({ avatar: `photo:${path}` }).eq("id", id));
    if (seedPhoto) await storage.remove([now.slice("photo:".length)]);
    set++;
  }
  return { set, kept, missing };
=======
async function insertEvent(id, ids) {
  const kst = new Date(Date.now() + 9 * 3600_000);
  do kst.setUTCDate(kst.getUTCDate() + 1);
  while (kst.getUTCDay() === 0 || kst.getUTCDay() === 6);
  const day = kst.toISOString().slice(0, 10);
  const starts_at = `${day}T14:00:00+09:00`;
  const ends_at = `${day}T15:00:00+09:00`;
  const room = must(await admin.from("rooms").select("id").eq("name", "M1 확산").single());

  const event = {
    id,
    title: "모바일앱 주간 회의",
    description: "요구사항 초안 검토와 화면 흐름도 일정 맞추기",
    starts_at,
    ends_at,
    room_id: room.id,
    created_by: ids.get("dhkim"),
  };
  let { error } = await admin.from("events").insert(event);
  if (error?.code === "23P01") ({ error } = await admin.from("events").insert({ ...event, room_id: null }));
  if (error) throw error;
>>>>>>> 7b972a0a2d3aebd31fe8032ac759cd9cd9ef9a66
}

// --contacts-only: 계정·채널·대화는 건드리지 않고 연락처만 채운다
if (process.argv.includes("--contacts-only")) {
  const ids = new Map(
    must(await admin.from("profiles").select("id, handle").in("handle", PEOPLE.map((p) => p.handle))).map((r) => [r.handle, r.id]),
  );
  const added = await seedContacts(ids);
  console.log(`연락처 ${added}명 새로 넣음 (직원 ${ids.size}명 가운데, 이미 있던 사람은 그대로)`);
  process.exit(0);
}

const chats = await loadChats();
const schedule = await loadSchedule();
if (chats.errors.length || schedule.errors.length) {
  const all = [...chats.errors, ...schedule.errors];
  console.error(
    `데이터 오류 ${all.length}개 (node scripts/seed-company/chats.mjs · schedule.mjs 로 전부 볼 수 있다):\n` + all.slice(0, 20).join("\n"),
  );
  process.exit(1);
}

const rooms = await seedRooms();
const units = await seedUnits();
const { ids, created } = await seedPeople(units);
const contacts = await seedContacts(ids);
const projects = await seedProjects(ids, units);
const dms = await seedDMs(ids, chats.channels);
const chat = await seedChats(chats.messages, ids, units, projects, dms);
const ev = await seedEvents(schedule.events, ids, rooms, projects);
const av = await seedAvatars(ids);

console.log(`조직 ${UNITS.length}개 (부서 채널 ${UNITS.length - 1}개 + #일반)`);
console.log(`직원 ${PEOPLE.length}명 (새로 만든 계정 ${created}명), 연락처 ${contacts}명 새로 넣음`);
console.log(
  `프로필 사진 ${av.set}명 새로 정함` +
    (av.kept.length ? `, 이미 고른 사진·캐릭터를 둔 사람 ${av.kept.join(", ")}` : "") +
    (av.missing.length ? `, 사진 파일 없음 ${av.missing.length}명 (avatars.mjs 로 만든다)` : ""),
);
console.log(`프로젝트·공지 채널 ${PROJECTS.length}개, DM ${dms.size}개`);
console.log(
  `대화 ${chats.messages.length}건 중 ${chat.inserted}건 새로 넣음` +
    (RESET_CHATS ? ` (먼저 시드 메시지 ${chat.removed}건 지움)` : "") +
    `, 리액션 ${chat.reactions}개, 고정 ${chat.pins}건, 알림 ${chat.notes}건 시각 맞춤`,
);
console.log(
  `회의실 ${ROOMS.length}개, 일정 ${schedule.events.length}건 중 ${ev.inserted}건 새로 넣음` +
    (RESET_EVENTS ? ` (먼저 시드 일정 ${ev.removed}건 지움)` : "") +
    `, 참석자 ${ev.attendees}명` +
    (ev.noRoom.length ? `, 시드 밖 예약과 겹쳐 회의실 없이 넣은 것 ${ev.noRoom.length}건: ${ev.noRoom.join(" / ")}` : ""),
);
console.log("\n로그인: <handle>@example.com + .env.local 의 SEED_PASSWORD (명단은 seed-company/roster.mjs 의 PEOPLE)");
console.log("예) 백엔드팀 사원 이서연(sylee@example.com) → #일반·#공지사항·플랫폼사업부·개발본부·백엔드팀·프로젝트-모바일앱·잡담");
