// 시연 회사 "한결테크 주식회사" 의 명단: 조직·사람·프로젝트 채널·DM 짝. seed-company.mjs 와 대화 검사(chats.mjs)가 같이 쓴다.
// 실명·실제 사내 정보는 쓰지 않는다. 이름은 지어낸 것이다.

/** #일반 (20260929100100_step1_compat.sql 에서 고정). 회사 조직의 채널로 쓴다 */
export const GENERAL = "00000000-0000-0000-0000-000000000001";

// ── 조직 ────────────────────────────────────────────────────
// key 는 시드 파일 안에서만 쓰는 이름. 순서대로 넣으므로 상위 조직이 먼저 와야 한다
export const UNITS = [
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
export const PEOPLE = [
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
  { handle: "jybae", name: "배준영", unit: "frontend", title: "사원", joined: "2026-09-07" },
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
  { handle: "jysim", name: "심재윤", unit: "finance", title: "사원", joined: "2026-09-07" },
];

// ── 프로젝트 채널 (부서를 넘나드는 채널) ─────────────────────
// 대화 파일에서는 "project:<n>" 으로 부른다. 만든 사람(owner)도 멤버다
export const PROJECTS = [
  {
    n: 1,
    name: "프로젝트-모바일앱",
    type: "private",
    owner: "dhkim",
    members: ["sylee", "hekang", "jamoon", "jmryu"],
    description: "모바일앱 신규 개발 — 요구사항·화면·개발 진행 공유",
  },
  {
    n: 2,
    name: "프로젝트-고객포털",
    type: "public",
    owner: "msjang",
    members: ["desong", "jhyoon", "yjshin", "hnjung", "dhkim"],
    description: "고객포털 개선 요청 모음. 누구나 들어와서 의견 주세요",
  },
  {
    n: 3,
    name: "잡담",
    type: "public",
    owner: "shbaek",
    members: [
      "gyyu", "hekang", "ysjo", "jybae", "sylee", "dyim", "sjhong", "cwyang", "syahn", "hnjung", "wjjeon",
      "mjgu", "jysim", "jwha", "desong", "ynchoi", "jamoon", "dhkim", "ebko", "yrjoo", "jmryu",
    ],
    description: "점심·맛집·소소한 이야기",
  },
  {
    n: 4,
    name: "배포-TF",
    type: "private",
    owner: "sjoh",
    members: ["jhyoon", "mhseo", "dhkim", "dyim", "hekang", "thkwon", "jamoon", "syahn"],
    description: "10월 1차 배포 준비 TF — 일정·체크리스트·이슈",
  },
  // 공지 채널 (20261001160000_notice_channel.sql): notice 부서(하위 부서 포함)·리더(owner)·부리더(subs)만 새 글을 쓴다.
  // 멤버는 회사 전원 — 공지 채널이 되면 DB 가 모든 사람을 넣는다 (시드가 아닌 계정도). 답글·리액션은 누구나
  {
    n: 5,
    name: "공지사항",
    type: "public",
    owner: "yhno",
    members: "all",
    notice: "support",
    subs: ["dhjung"],
    description: "사내 공지 — 경영지원본부가 올립니다. 궁금한 점은 공지에 답글로 남겨 주세요",
  },
];
