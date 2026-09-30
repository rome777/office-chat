// 회사 시드 데이터. 가상 회사 "한결테크 주식회사" 의 조직(회사 → 사업부 → 본부 → 팀)과 직원 37명,
// 부서 채널, 프로젝트 채널 2개, 샘플 대화, 샘플 회의를 만든다. 운영 DB 에도 이것을 넣는다 (2026-09-29).
// 실행: .env.local 에 SEED_PASSWORD=<비밀번호 6자 이상> 을 넣고 npm run seed:company
//
// 여러 번 돌려도 된다: 이 스크립트가 만든 계정(가입 정보 seed = "company")은 이름·소속·직급만 맞추고,
// 대화·회의는 다시 넣지 않는다. 비밀번호는 새로 만들 때만 정하고 다시 바꾸지 않는다.
// 이 스크립트가 만들지 않은 계정은 메일 주소가 겹쳐도 건드리지 않는다 (기존 계정은 그대로 둔다).
// 새 계정은 모두 SEED_PASSWORD 하나를 쓴다. 비밀번호는 저장소·문서에 쓰지 않는다.
//
// 부서 채널은 DB 가 만든다 (supabase/migrations/20260929170000_org_units.sql):
//   조직을 넣으면 같은 이름의 비공개 채널이 생기고, 사람의 소속(profiles.org_unit_id)을 정하면
//   그 조직과 모든 상위 조직의 채널에 자동으로 들어간다. 회사 채널은 #일반 이다.
//
// 실명·실제 사내 정보는 쓰지 않는다. 이름은 지어낸 것이고, example.com 은 예시용으로 예약된 도메인이라 실제 메일이 가지 않는다.
import { createClient } from "@supabase/supabase-js";

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

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** #일반 (20260929100100_step1_compat.sql 에서 고정). 회사 조직의 채널로 쓴다 */
const GENERAL = "00000000-0000-0000-0000-000000000001";
// 시드가 만드는 것의 id 는 고정한다 (다시 돌려도 같은 행을 찾게)
const unitId = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const channelId = (n) => `0b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const messageId = (n) => `0c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eventId = (n) => `0e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ── 조직 ────────────────────────────────────────────────────
// key 는 이 파일 안에서만 쓰는 이름. 순서대로 넣으므로 상위 조직이 먼저 와야 한다
const UNITS = [
  { key: "company", n: 1, name: "한결테크 주식회사", kind: "company", parent: null, channel: GENERAL },
  { key: "platform", n: 10, name: "플랫폼사업부", kind: "division", parent: "company" },
  { key: "dev", n: 11, name: "개발본부", kind: "hq", parent: "platform" },
  { key: "backend", n: 12, name: "백엔드팀", kind: "team", parent: "dev" },
  { key: "frontend", n: 13, name: "프론트엔드팀", kind: "team", parent: "dev" },
  { key: "service", n: 14, name: "서비스기획본부", kind: "hq", parent: "platform" },
  { key: "planning", n: 15, name: "서비스기획팀", kind: "team", parent: "service" },
  { key: "ux", n: 16, name: "UX디자인팀", kind: "team", parent: "service" },
  { key: "sales", n: 20, name: "영업사업부", kind: "division", parent: "company" },
  { key: "domestic", n: 21, name: "국내영업본부", kind: "hq", parent: "sales" },
  { key: "sales1", n: 22, name: "영업1팀", kind: "team", parent: "domestic" },
  { key: "sales2", n: 23, name: "영업2팀", kind: "team", parent: "domestic" },
  { key: "marketingHq", n: 24, name: "마케팅본부", kind: "hq", parent: "sales" },
  { key: "marketing", n: 25, name: "마케팅팀", kind: "team", parent: "marketingHq" },
  { key: "support", n: 30, name: "경영지원본부", kind: "hq", parent: "company" },
  { key: "hr", n: 31, name: "인사팀", kind: "team", parent: "support" },
  { key: "finance", n: 32, name: "재무팀", kind: "team", parent: "support" },
];

// ── 사람 ────────────────────────────────────────────────────
// title 은 직급. lead 가 있으면 그 조직의 장(대표·사업부장·본부장·팀장)이다. 메일은 <handle>@example.com.
// 원래 있던 시연 계정(사용자A·B·관리자·비회원C)은 넣지 않는다 — 기존 계정은 소속 없이 그대로 둔다.
// 권한 시연: 정하늘(영업1팀)은 개발 쪽 부서 채널·프로젝트-모바일앱 의 비회원이다. 관리자 권한은 아무에게도 주지 않는다
const PEOPLE = [
  { handle: "dhjung", name: "정대현", unit: "company", title: "대표이사", lead: true },

  { handle: "swhan", name: "한승우", unit: "platform", title: "전무", lead: true },
  { handle: "sjoh", name: "오세진", unit: "dev", title: "상무", lead: true },
  { handle: "jhyoon", name: "윤재혁", unit: "backend", title: "부장", lead: true },
  { handle: "dhkim", name: "김도현", unit: "backend", title: "과장" },
  { handle: "dyim", name: "임도윤", unit: "backend", title: "대리" },
  { handle: "sylee", name: "이서연", unit: "backend", title: "사원" },
  { handle: "mhseo", name: "서민호", unit: "frontend", title: "차장", lead: true },
  { handle: "hekang", name: "강하은", unit: "frontend", title: "대리" },
  { handle: "ysjo", name: "조윤서", unit: "frontend", title: "사원" },
  { handle: "jybae", name: "배준영", unit: "frontend", title: "사원" },
  { handle: "yjshin", name: "신유진", unit: "service", title: "이사", lead: true },
  { handle: "thkwon", name: "권태호", unit: "planning", title: "차장", lead: true },
  { handle: "jamoon", name: "문지아", unit: "planning", title: "과장" },
  { handle: "sjhong", name: "홍서준", unit: "planning", title: "사원" },
  { handle: "jmryu", name: "류지민", unit: "ux", title: "과장", lead: true },
  { handle: "syahn", name: "안소연", unit: "ux", title: "대리" },
  { handle: "cwyang", name: "양채원", unit: "ux", title: "사원" },

  { handle: "tskim", name: "김태식", unit: "sales", title: "전무", lead: true },
  { handle: "jmpark", name: "박정민", unit: "domestic", title: "상무", lead: true },
  { handle: "sclee", name: "이상철", unit: "sales1", title: "부장", lead: true },
  { handle: "ynchoi", name: "최유나", unit: "sales1", title: "대리" },
  { handle: "hnjung", name: "정하늘", unit: "sales1", title: "사원" },
  { handle: "msjang", name: "장민석", unit: "sales2", title: "차장", lead: true },
  { handle: "desong", name: "송다은", unit: "sales2", title: "과장" },
  { handle: "wjjeon", name: "전우진", unit: "sales2", title: "사원" },
  { handle: "sbhwang", name: "황수빈", unit: "marketingHq", title: "이사", lead: true },
  { handle: "ebko", name: "고은비", unit: "marketing", title: "부장", lead: true },
  { handle: "shbaek", name: "백승현", unit: "marketing", title: "대리" },
  { handle: "gyyu", name: "유가영", unit: "marketing", title: "사원" },

  { handle: "yhno", name: "노영훈", unit: "support", title: "상무", lead: true },
  { handle: "jhpark", name: "박지훈", unit: "hr", title: "부장", lead: true },
  { handle: "jwha", name: "하지원", unit: "hr", title: "대리" },
  { handle: "mjgu", name: "구민재", unit: "hr", title: "사원" },
  { handle: "hwcha", name: "차현우", unit: "finance", title: "차장", lead: true },
  { handle: "yrjoo", name: "주예린", unit: "finance", title: "과장" },
  { handle: "jysim", name: "심재윤", unit: "finance", title: "사원" },
];

// ── 프로젝트 채널 (부서를 넘나드는 채널) ─────────────────────
const PROJECTS = [
  {
    n: 1,
    name: "프로젝트-모바일앱",
    type: "private",
    owner: "dhkim",
    members: ["sylee", "hekang", "jamoon", "jmryu"],
  },
  {
    n: 2,
    name: "프로젝트-고객포털",
    type: "public",
    owner: "msjang",
    members: ["desong", "jhyoon", "yjshin", "hnjung", "dhkim"],
  },
];

// ── 샘플 대화 ───────────────────────────────────────────────
// 멘션(@handle), 기한이 있는 할 일, 기한이 없는 할 일이 모두 들어 있다 (알림·AI 할 일 시연용).
// 멘션은 그 채널 멤버에게만 알림이 간다
const CHATS = [
  {
    channel: "company",
    lines: [
      ["dhjung", "전사 공지입니다. 10월 1일은 창립 기념일이라 오후 3시 이후 자유 퇴근입니다."],
      ["jhpark", "연말정산 사전 서류는 10월 15일까지 인사팀으로 제출해 주세요."],
      ["yhno", "사무실 공기청정기 필터 교체가 이번 주에 있습니다. 불편하시면 경영지원본부로 알려 주세요."],
    ],
  },
  {
    channel: "platform",
    lines: [
      ["swhan", "하반기 목표 점검 회의를 다음 주에 잡겠습니다. 본부별로 진행 상황을 정리해 주세요."],
      ["yjshin", "서비스기획본부는 금요일까지 정리해서 올리겠습니다."],
      ["sjoh", "개발본부도 금요일까지 드리겠습니다."],
    ],
  },
  {
    channel: "dev",
    lines: [
      ["sjoh", "10월 배포 일정 공유드립니다. 1차 배포는 10월 2일 오전입니다."],
      ["jhyoon", "백엔드팀은 일정 문제 없습니다."],
      ["mhseo", "@sjoh 본부장님, 배포 전 QA 인원 두 명 요청드려도 될까요?"],
      ["sjoh", "네, 다음 주 월요일까지 QA 두 명 배정하겠습니다."],
    ],
  },
  {
    channel: "backend",
    lines: [
      ["jhyoon", "이번 주 스프린트 정리합니다. 로그인 API 는 끝났고 검색 API 가 남았어요."],
      ["dhkim", "검색 API 는 제가 맡겠습니다. 목요일까지 PR 올릴게요."],
      ["jhyoon", "@sylee 첨부 업로드 테스트 케이스 좀 추가해 주세요. 급하진 않아요."],
      ["sylee", "네, 확인했습니다!"],
      ["dyim", "DB 인덱스 점검은 금요일까지 제가 끝내겠습니다."],
    ],
  },
  {
    channel: "frontend",
    lines: [
      ["mhseo", "디자인 시안이 나오면 바로 작업 들어갑니다. 공통 컴포넌트 정리는 @hekang 님이 맡아 주세요."],
      ["hekang", "네, 이번 주 안에 목록 정리해 두겠습니다."],
      ["ysjo", "다크 모드 색 값은 제가 한 번 훑어볼게요."],
    ],
  },
  {
    channel: "sales1",
    lines: [
      ["sclee", "이번 달 신규 계약 목표 5건 중 3건 완료했습니다. 수고 많으셨습니다."],
      ["ynchoi", "고객사 제안서 수정본은 수요일까지 보내겠습니다."],
      ["sclee", "@hnjung 다음 고객 미팅 자료 정리 부탁해요."],
      ["hnjung", "네, 정리해서 공유드리겠습니다."],
    ],
  },
  {
    channel: "hr",
    lines: [
      ["jhpark", "신규 입사자 온보딩 자료 업데이트가 필요합니다. @jwha 이번 주 금요일까지 가능할까요?"],
      ["jwha", "네, 금요일까지 하겠습니다."],
      ["mjgu", "교육 일정표는 제가 같이 정리할게요."],
    ],
  },
  {
    project: 1,
    lines: [
      ["dhkim", "모바일앱 킥오프합니다! 이 채널에서 진행 상황을 공유해요."],
      ["jamoon", "요구사항 문서 초안은 10월 4일까지 드리겠습니다."],
      ["jmryu", "화면 흐름도는 초안이 나오면 바로 시작할게요."],
      ["dhkim", "@sylee 푸시 알림 라이브러리 조사 부탁해요. 기한은 따로 없어요."],
      ["hekang", "프론트 프로젝트 세팅은 제가 해 둘게요."],
    ],
  },
  {
    project: 2,
    lines: [
      ["msjang", "고객포털 개선 요청을 모아 두는 채널입니다. 누구나 들어와서 의견 주세요."],
      ["desong", "고객사 세 곳에서 로그인 오류 문의가 있었습니다."],
      ["jhyoon", "확인해 보겠습니다. @desong 재현 방법을 알려 주시면 좋겠어요."],
    ],
  },
];

// ── 실행 ────────────────────────────────────────────────────

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

async function seedRooms() {
  // supabase/seed.sql 과 같다 (원격에는 이 스크립트로 넣는다)
  must(
    await admin.from("rooms").upsert(
      [
        { name: "회의실 1 (소)", capacity: 4, location: "3층" },
        { name: "회의실 2 (중)", capacity: 8, location: "3층" },
        { name: "회의실 3 (대)", capacity: 16, location: "5층" },
      ],
      { onConflict: "name", ignoreDuplicates: true },
    ),
  );
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

async function seedProjects(ids) {
  const out = new Map();
  for (const pj of PROJECTS) {
    const id = channelId(pj.n);
    const found = must(await admin.from("channels").select("id").eq("id", id));
    if (found.length === 0) {
      // 만든 사람은 트리거(channels_add_creator)가 멤버로 넣는다
      must(await admin.from("channels").insert({ id, name: pj.name, type: pj.type, created_by: ids.get(pj.owner) }));
    }
    must(
      await admin.from("memberships").upsert(
        [pj.owner, ...pj.members].map((h) => ({ channel_id: id, user_id: ids.get(h) })),
        { onConflict: "channel_id,user_id", ignoreDuplicates: true },
      ),
    );
    out.set(pj.n, id);
  }
  return out;
}

/** 샘플 대화. client_id 가 고정이라 다시 돌려도 한 번만 들어간다. 몇 분 간격으로 최근 시각을 붙인다 */
async function seedChats(ids, units, projects) {
  let n = 0;
  let inserted = 0;
  const total = CHATS.reduce((s, c) => s + c.lines.length, 0);
  const start = Date.now() - total * 3 * 60_000;
  for (const chat of CHATS) {
    const channel = chat.project ? projects.get(chat.project) : units.get(chat.channel).channel_id;
    for (const [handle, body] of chat.lines) {
      n++;
      const rows = must(
        await admin
          .from("messages")
          .upsert(
            {
              client_id: messageId(n),
              channel_id: channel,
              user_id: ids.get(handle),
              body,
              created_at: new Date(start + n * 3 * 60_000).toISOString(),
            },
            { onConflict: "client_id", ignoreDuplicates: true },
          )
          .select("id"),
      );
      inserted += rows.length;
    }
  }
  return inserted;
}

/** 샘플 회의: 김도현이 만들고 이서연·문지아·류지민이 참석한다. 정하늘은 참석하지 않는다 (캘린더 권한 시연용).
 *  다음 평일 오후 2시(한국 시간), 회의실 2. 그 시간에 회의실이 이미 차 있으면 회의실 없이 만든다 */
async function seedEvent(ids) {
  const id = eventId(1);
  const exists = must(await admin.from("events").select("id").eq("id", id)).length > 0;
  if (!exists) await insertEvent(id, ids);
  // 회의가 있어도 참석자는 채운다 (참석자를 넣다가 멈춘 적이 있다). 이미 있는 참석자·응답은 그대로 둔다.
  // 여러 행을 한 번에 넣을 때 어떤 행에 없는 컬럼은 기본값이 아니라 null 이 들어가므로 모든 행에 response 를 적는다
  must(
    await admin.from("event_attendees").upsert(
      [
        { event_id: id, user_id: ids.get("dhkim"), response: "accepted", responded_at: new Date().toISOString() },
        ...["sylee", "jamoon", "jmryu"].map((h) => ({ event_id: id, user_id: ids.get(h), response: "pending", responded_at: null })),
      ],
      { onConflict: "event_id,user_id", ignoreDuplicates: true },
    ),
  );
  return !exists;
}

async function insertEvent(id, ids) {
  const kst = new Date(Date.now() + 9 * 3600_000);
  do kst.setUTCDate(kst.getUTCDate() + 1);
  while (kst.getUTCDay() === 0 || kst.getUTCDay() === 6);
  const day = kst.toISOString().slice(0, 10);
  const starts_at = `${day}T14:00:00+09:00`;
  const ends_at = `${day}T15:00:00+09:00`;
  const room = must(await admin.from("rooms").select("id").eq("name", "회의실 2 (중)").single());

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
}

await seedRooms();
const units = await seedUnits();
const { ids, created } = await seedPeople(units);
const projects = await seedProjects(ids);
const messages = await seedChats(ids, units, projects);
const event = await seedEvent(ids);

console.log(`조직 ${UNITS.length}개 (부서 채널 ${UNITS.length - 1}개 + #일반)`);
console.log(`직원 ${PEOPLE.length}명 (새로 만든 계정 ${created}명)`);
console.log(`프로젝트 채널 ${PROJECTS.length}개, 샘플 메시지 ${messages}건 새로 넣음, 샘플 회의 ${event ? "새로 만듦" : "이미 있음"}`);
console.log("\n로그인: <handle>@example.com + .env.local 의 SEED_PASSWORD (명단은 이 파일의 PEOPLE)");
console.log("예) 백엔드팀 사원 이서연(sylee@example.com) → #일반·플랫폼사업부·개발본부·백엔드팀·프로젝트-모바일앱");
