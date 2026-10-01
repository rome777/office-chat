// 회의실·일정 시드 데이터와 펼치기·검사. seed-company.mjs 가 넣는다. DB 없이 검사만: node scripts/seed-company/schedule.mjs
//
// 회의실 8개 — C1~C4 는 큰 방(대회의실·임원/고객·교육·상황실), M1~M4 는 작은 방(2~8명). 이름은 사용자가 정했다 (2026-10-01).
// 원래 있던 회의실 3개는 지우지 않고 이름을 바꾼다 (was) — 이미 그 방에 잡힌 일정(김송이 시연용 반복 일정 등)이 그대로 이어진다.
// 일정은 2026년 9~10월: 반복 회의(팀 주간 회의·데일리 스크럼·1:1·멘토링), 한 번 있는 회의·업무 마감·외근·개인 일정·휴가.
// 대화(chats/*.mjs)와 사실을 맞췄다 — 타운홀 9/3, 킥오프 9/14, 핫픽스 9/15 10시, 회고 9/18 14시, 리허설 9/30 14시, 기념식 10/1 14시,
// 1차 배포 10/2 오전, 면접 10/7·10/8 오후 M3 가치, 이서연 연차 10/16, 웨비나 10/22 등. 공휴일(추석·개천절 대체·한글날)은 건너뛴다.
// 시연일 10/2(금)는 회의실 8개가 고루 차고, 시연 인물(이서연·김도현·정하늘)의 하루가 꽉 차게 둔다 (2026-10-01).
//
// 일정 id 는 key·날짜로 정해진다 (다시 돌려도 같은 행). 시드 일정 id 는 모두 0e000000- 로 시작한다 (--reset-events 가 이 범위만 지운다).
// 참석 응답을 정하지 않으면 key·사람으로 정한다: 지난 일정은 대부분 수락, 앞으로의 일정은 수락·대기가 섞인다.
// 휴가·병원·외근과 겹치는 회의는 그 사람이 불참으로 답한 것으로 둔다. 겹치는 회의실·사람·휴가 중 대화는 검사가 오류로 알려 준다.
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PEOPLE } from "./roster.mjs";
import { channelMembers, unitMembers, loadChats } from "./chats.mjs";

// 층(location)·시설·설명은 원격 DB 와 같다 — 마이그레이션 20261001180000_rooms_data · supabase/seed.sql
export const ROOMS = [
  { name: "C1 상생", was: "회의실 3 (대)", capacity: 30, location: "5층", facilities: ["projector", "video", "mic"], description: "대회의실 · 무선 마이크 2개 · 타운홀·행사", sort_order: 10 },
  { name: "C2 신뢰", capacity: 12, location: "5층", facilities: ["monitor", "video"], description: "보안 회의 · 임원·고객 미팅 우선", sort_order: 20 },
  { name: "C3 열정", capacity: 20, location: "3층", facilities: ["projector"], description: "교육실 · 노트북 대여 6대 · 교육·온보딩", sort_order: 30 },
  { name: "C4 이끔", capacity: 12, location: "6층", facilities: ["monitor", "video"], description: "85인치 TV · 스프린트·배포 상황실", sort_order: 40 },
  { name: "M1 확산", was: "회의실 2 (중)", capacity: 8, location: "5층", facilities: ["video", "mic", "whiteboard"], description: "화상회의 카메라·스피커폰", sort_order: 50 },
  { name: "M2 공유", was: "회의실 1 (소)", capacity: 4, location: "5층", facilities: ["monitor"], description: "C1 옆 · 55인치 TV·화면 공유", sort_order: 60 },
  { name: "M3 가치", capacity: 4, location: "6층", facilities: ["monitor", "whiteboard"], description: "소회의실 · 면접 가능", sort_order: 70 },
  { name: "M4 연구", capacity: 2, location: "6층", facilities: ["video"], description: "2인 화상회의 부스 · 방음 · 1:1 면담", sort_order: 80 },
];

/** 쉬는 날 (주말 말고) — components/calendar/kinds.ts 의 HOLIDAYS 와 같다 */
const HOLIDAYS = new Set(["2026-09-24", "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05", "2026-10-09"]);

const SUBTYPES = {
  meeting: ["meeting", "team_meeting", "project_talk", "one_on_one"],
  work: ["deadline", "design", "project", "focus"],
  personal: ["appointment", "hospital", "errand", "meal", "anniversary"],
  outside: ["client_visit", "trip", "external_meeting", "site_visit"],
  leave: ["annual", "half", "sick", "leave_of_absence", "other"],
};

// ── 반복 일정 ───────────────────────────────────────────────
// repeat: weekly(시작 요일마다)·weekdays(평일)·daily·monthly(시작 날짜마다). 공휴일은 만들지 않는다.
// who: handle 또는 "unit:<부서 key>"·"project:<n>"·"all" (그날 입사 전인 사람은 뺀다). 만든 사람(by)은 늘 참석(수락)
// cancel: 취소된 회차(날짜), answers: { 날짜: { declined: [...] } } 회차별 응답
const SERIES = [
  { key: "exec-weekly", title: "경영진 주간 회의", kind: "meeting", subtype: "team_meeting", repeat: "weekly", from: "2026-09-07", until: "2026-10-26", start: "08:30", end: "09:20", room: "C2 신뢰", by: "dhjung", who: ["swhan", "tskim", "yhno"], description: "사업부·본부 주요 지표와 이슈 공유" },
  { key: "domestic-pipeline", title: "국내영업본부 주간 파이프라인 회의", kind: "meeting", subtype: "team_meeting", repeat: "weekly", from: "2026-09-07", until: "2026-10-26", start: "09:00", end: "09:50", room: "M1 확산", by: "jmpark", who: ["unit:domestic"], description: "팀별 진행 건 확률·다음 단계 점검" },
  { key: "backend-weekly", title: "백엔드팀 주간 회의", kind: "meeting", subtype: "team_meeting", repeat: "weekly", from: "2026-09-07", until: "2026-10-05", start: "10:00", end: "10:30", room: "M2 공유", by: "jhyoon", who: ["unit:backend"], cancel: ["2026-09-14"], description: "지난주 정리 · 이번 주 할 일 · 막힌 것 (9/14 은 모바일앱 킥오프로 쉼)" },
  { key: "dev-leads", title: "개발본부 리더 회의", kind: "meeting", subtype: "team_meeting", repeat: "weekly", from: "2026-09-07", until: "2026-10-26", start: "14:00", end: "14:40", room: "M3 가치", by: "sjoh", who: ["jhyoon", "mhseo"], description: "본부 일정·인력·기술 부채 점검" },
  { key: "backend-scrum", title: "백엔드팀 데일리 스크럼", kind: "meeting", subtype: "team_meeting", repeat: "weekdays", from: "2026-09-14", until: "2026-10-30", start: "09:40", end: "09:55", location: "6층 백엔드팀 자리", by: "jhyoon", who: ["unit:backend"], remind: [], cancel: ["2026-10-02"], description: "어제 한 일 · 오늘 할 일 · 막힌 것 (15분)" },
  { key: "frontend-weekly", title: "프론트엔드팀 주간 회의", kind: "meeting", subtype: "team_meeting", repeat: "weekly", from: "2026-09-01", until: "2026-10-27", start: "10:30", end: "11:00", room: "M3 가치", by: "mhseo", who: ["unit:frontend"], answers: { "2026-09-08": { declined: ["jybae"] } }, description: "화면 작업 진행·리뷰 요청 정리" },
  { key: "marketing-weekly", title: "마케팅팀 주간 회의", kind: "meeting", subtype: "team_meeting", repeat: "weekly", from: "2026-09-01", until: "2026-10-27", start: "10:00", end: "10:40", room: "M2 공유", by: "ebko", who: ["unit:marketing"], description: "웨비나·뉴스레터·사례집 진행 점검" },
  { key: "support-weekly", title: "경영지원본부 주간 회의", kind: "meeting", subtype: "team_meeting", repeat: "weekly", from: "2026-09-02", until: "2026-10-28", start: "09:00", end: "09:50", room: "M1 확산", by: "yhno", who: ["unit:support"], description: "인사·재무·총무 주간 이슈" },
  { key: "planning-weekly", title: "서비스기획팀 주간 회의", kind: "meeting", subtype: "team_meeting", repeat: "weekly", from: "2026-09-02", until: "2026-10-28", start: "10:00", end: "10:40", room: "M3 가치", by: "thkwon", who: ["unit:planning"], description: "개선 요청 우선순위·문서 진행" },
  { key: "mentoring", title: "배준영 멘토링", kind: "meeting", subtype: "one_on_one", repeat: "weekly", from: "2026-09-09", until: "2026-10-28", start: "16:00", end: "16:30", room: "M4 연구", by: "hekang", who: ["jybae"], description: "한 주 동안 막힌 것·코드 리뷰 피드백" },
  { key: "ux-review", title: "UX디자인팀 디자인 리뷰", kind: "meeting", subtype: "team_meeting", repeat: "weekly", from: "2026-09-03", until: "2026-10-29", start: "11:00", end: "12:00", room: "M3 가치", by: "jmryu", who: ["unit:ux"], description: "시안 리뷰 · 디자인 시스템 토큰 점검" },
  { key: "mobile-weekly", title: "모바일앱 주간 회의", kind: "meeting", subtype: "project_talk", repeat: "weekly", from: "2026-09-17", until: "2026-10-01", start: "14:00", end: "15:00", room: "M1 확산", by: "dhkim", who: ["project:1"], channel: "project:1", cancel: ["2026-10-01"], description: "요구사항·화면 흐름도·개발 진행 점검 (10/1 은 창립 기념식으로 쉼)" },
  // ↑ 10/8 부터는 시연에서 김도현이 화면으로 새로 잡는다 (PRD 시연 순서 7 — 10/8 목 14시 M1 확산, 이서연·문지아). 그래서 10/1 에서 끝낸다
  { key: "running", title: "러닝 모임", kind: "personal", subtype: "appointment", repeat: "weekly", from: "2026-09-10", until: "2026-10-29", start: "19:00", end: "20:00", location: "회사 앞 하천 산책로", by: "sylee", who: ["shbaek", "dyim", "ysjo", "gyyu", "wjjeon"], visibility: "public", description: "사내 러닝 동호회 — 5km 가볍게" },
  { key: "oneonone-sylee", title: "윤재혁·이서연 1:1", kind: "meeting", subtype: "one_on_one", repeat: "weekly", from: "2026-09-04", until: "2026-10-30", start: "16:30", end: "17:00", room: "M4 연구", by: "jhyoon", who: ["sylee"], cancel: ["2026-09-18", "2026-10-02"], description: "업무 적응·성장 이야기" },
  { key: "onboarding-sep", title: "신규 입사자 온보딩 교육", kind: "meeting", subtype: "meeting", repeat: "daily", from: "2026-09-07", until: "2026-09-09", start: "10:00", end: "12:00", room: "C3 열정", by: "jwha", who: ["jybae", "jysim", "mjgu"], description: "9/7 회사 소개·계정 발급 · 9/8 보안·제품 교육 · 9/9 부서별 업무 소개" },
  { key: "deploy-tf-daily", title: "배포 TF 데일리 점검", kind: "meeting", subtype: "project_talk", repeat: "weekdays", from: "2026-09-28", until: "2026-10-02", start: "17:00", end: "17:20", room: "C4 이끔", by: "sjoh", who: ["project:4"], channel: "project:4", cancel: ["2026-10-01"], description: "블로커 버그·체크리스트 진행률" },
  { key: "card-deadline", title: "법인카드 영수증 마감", kind: "work", subtype: "deadline", repeat: "monthly", from: "2026-09-30", until: "2026-10-30", allDay: true, by: "yrjoo", who: ["unit:finance"], description: "비용 시스템 등록 마감 — 늦으면 다음 달 비용으로" },
];

// ── 한 번 있는 일정 ─────────────────────────────────────────
// date + start·end (시각) 또는 allDay (until 까지 여러 날). created: 만든 시각 (없으면 며칠 전으로 정한다)
// overflow: 정원보다 많이 초대한 행사 (타운홀 — 옆방 중계). weekend: 주말·공휴일이어도 되는 마감
const EVENTS = [
  // 9월 첫 주
  { key: "leave-desong-0904", title: "연차", kind: "leave", subtype: "annual", date: "2026-09-04", allDay: true, by: "desong", created: "2026-08-28 10:00" },
  { key: "townhall-h2", title: "하반기 전사 타운홀", kind: "meeting", subtype: "meeting", date: "2026-09-03", start: "16:00", end: "17:00", room: "C1 상생", by: "dhjung", who: ["all"], overflow: true, created: "2026-08-31 17:00", description: "하반기 목표·조직 운영 방향 공유, 질의응답. 자리가 모자라면 M2 공유에서 화면 중계" },
  { key: "onboarding-intro", title: "온보딩 — 한결 오피스 서비스 소개", kind: "meeting", subtype: "meeting", date: "2026-09-08", start: "14:00", end: "15:00", room: "C1 상생", by: "jwha", who: ["jybae", "jysim", "thkwon"], created: "2026-09-04 11:00", description: "강사: 권태호 차장" },
  { key: "login-war", title: "고객포털 로그인 오류 긴급 점검", kind: "meeting", subtype: "project_talk", date: "2026-09-08", start: "17:00", end: "17:40", room: "C4 이끔", by: "jhyoon", who: ["dhkim", "dyim", "sylee", "desong"], channel: "project:2", created: "2026-09-08 16:40", description: "가온물산·누리유통·새봄식품 문의 — 재현 방법과 로그 확인" },
  { key: "onboarding-security", title: "온보딩 — 정보보안 교육", kind: "meeting", subtype: "meeting", date: "2026-09-09", start: "14:00", end: "15:00", room: "C3 열정", by: "jwha", who: ["jybae", "jysim", "dyim"], created: "2026-09-04 11:10", description: "강사: 임도윤 대리" },
  { key: "platform-h2", title: "플랫폼사업부 하반기 목표 점검", kind: "meeting", subtype: "meeting", date: "2026-09-09", start: "14:00", end: "15:30", room: "C2 신뢰", by: "swhan", who: ["sjoh", "yjshin", "jhyoon", "mhseo", "thkwon", "jmryu"], created: "2026-09-02 09:45", description: "본부별 하반기 진행 상황 보고" },
  { key: "token-share", title: "세션 토큰 갱신 버그 원인 공유", kind: "meeting", subtype: "project_talk", date: "2026-09-10", start: "15:00", end: "16:00", room: "C4 이끔", by: "dhkim", who: ["jhyoon", "dyim", "sylee", "mhseo", "hekang"], created: "2026-09-10 11:30", description: "갱신 요청이 동시에 두 번 가면 하나가 무효 처리되는 문제 — 수정 방향" },
  { key: "leave-syahn-0911", title: "연차", kind: "leave", subtype: "annual", date: "2026-09-11", allDay: true, by: "syahn", created: "2026-09-03 14:00" },
  { key: "hamil-sign", title: "해밀캐피탈 계약 서명", kind: "outside", subtype: "client_visit", date: "2026-09-11", start: "14:30", end: "16:00", location: "해밀캐피탈 본사", by: "sclee", who: ["ynchoi"], created: "2026-09-07 11:00" },
  { key: "hamil-dinner", title: "해밀캐피탈 계약 축하 회식", kind: "personal", subtype: "meal", date: "2026-09-11", start: "18:30", end: "20:30", location: "회사 앞 고깃집", by: "sclee", who: ["ynchoi", "hnjung"], visibility: "public", created: "2026-09-11 16:30" },
  // 9월 셋째 주
  { key: "mobile-kickoff", title: "모바일앱 프로젝트 킥오프", kind: "meeting", subtype: "project_talk", date: "2026-09-14", start: "10:00", end: "11:00", room: "M1 확산", by: "dhkim", who: ["project:1", "thkwon", "yjshin"], channel: "project:1", created: "2026-09-08 15:00", description: "목표(12월 베타)·역할·일정 정하기" },
  { key: "checkup-sylee", title: "건강검진", kind: "personal", subtype: "hospital", date: "2026-09-15", start: "08:00", end: "09:30", by: "sylee", created: "2026-09-10 12:20" },
  { key: "leave-wjjeon-0915", title: "연차", kind: "leave", subtype: "annual", date: "2026-09-15", allDay: true, by: "wjjeon", created: "2026-09-08 09:30" },
  { key: "hotfix", title: "로그인 핫픽스 배포", kind: "work", subtype: "deadline", date: "2026-09-15", start: "10:00", end: "10:30", by: "dhkim", who: ["jhyoon", "dyim", "sylee"], created: "2026-09-10 12:10", description: "세션 토큰 갱신 수정 — 배포 뒤 고객사 세 곳 확인 요청" },
  { key: "mir-demo", title: "미르건설 담당자 방문 데모", kind: "meeting", subtype: "meeting", date: "2026-09-15", start: "15:00", end: "16:00", room: "C2 신뢰", by: "hnjung", who: ["jamoon", "sclee"], created: "2026-09-08 15:30", description: "현장 인력 사진 공유·결재 흐름 시연 (기획팀 문지아 과장)" },
  { key: "dasom-nego", title: "다솜제약 재계약 협상", kind: "outside", subtype: "client_visit", date: "2026-09-16", start: "14:00", end: "16:00", location: "다솜제약 본사", by: "msjang", who: ["desong"], created: "2026-09-10 17:00" },
  { key: "barun-interview", title: "바른교육 도입 사례 인터뷰", kind: "outside", subtype: "external_meeting", date: "2026-09-17", start: "15:00", end: "16:30", location: "바른교육 본사", by: "ebko", who: ["shbaek", "gyyu"], created: "2026-09-09 10:30" },
  { key: "checkup-hnjung", title: "건강검진", kind: "personal", subtype: "hospital", date: "2026-09-18", start: "08:00", end: "11:00", by: "hnjung", created: "2026-09-14 10:00" },
  { key: "leave-cwyang-0918", title: "연차", kind: "leave", subtype: "annual", date: "2026-09-18", allDay: true, by: "cwyang", created: "2026-09-10 15:00" },
  { key: "onsaemiro-sign", title: "온새미로지스틱스 계약 서명", kind: "outside", subtype: "client_visit", date: "2026-09-18", start: "11:00", end: "12:00", location: "온새미로지스틱스 본사", by: "msjang", who: ["desong"], created: "2026-09-16 18:00" },
  { key: "incident-retro", title: "고객포털 장애 회고 (9/17)", kind: "meeting", subtype: "meeting", date: "2026-09-18", start: "14:00", end: "15:00", room: "C4 이끔", by: "sjoh", who: ["unit:dev"], created: "2026-09-17 11:00", description: "타임라인 · 원인(DB 커넥션 풀) · 재발 방지(커넥션 알림·느린 쿼리 점검)" },
  { key: "scope-fix", title: "고객포털 개편 범위 확정", kind: "meeting", subtype: "project_talk", date: "2026-09-18", start: "16:30", end: "17:30", room: "C2 신뢰", by: "yjshin", who: ["sjoh", "thkwon", "jamoon", "jhyoon", "mhseo", "msjang"], created: "2026-09-16 09:30", description: "1차 배포 범위: 검색 개선·로그인 개선·대시보드 개편 — 10/2 오전 배포" },
  // 9월 넷째 주
  { key: "leave-sjhong-0921", title: "병가", kind: "leave", subtype: "sick", date: "2026-09-21", allDay: true, by: "sjhong", created: "2026-09-21 08:20" },
  { key: "checkup-ynchoi", title: "건강검진", kind: "personal", subtype: "hospital", date: "2026-09-22", start: "08:00", end: "10:00", by: "ynchoi", created: "2026-09-15 13:00" },
  { key: "newsletter-sep", title: "9월 뉴스레터 발송", kind: "work", subtype: "deadline", date: "2026-09-22", start: "14:00", end: "14:30", by: "shbaek", who: ["gyyu", "ebko"], created: "2026-09-14 10:40" },
  { key: "mir-pt", title: "미르건설 제안 PT", kind: "outside", subtype: "client_visit", date: "2026-09-22", start: "14:00", end: "15:30", location: "미르건설 본사", by: "sclee", who: ["ynchoi", "hnjung"], created: "2026-09-15 17:30", description: "정하늘 사원 사례 파트 발표 (온새미로지스틱스 사례)" },
  { key: "table-focus", title: "테이블 컴포넌트 마무리", kind: "work", subtype: "focus", date: "2026-09-22", start: "13:00", end: "17:00", by: "hekang", created: "2026-09-21 18:00" },
  // 9월 마지막 주 — 배포 주간
  { key: "notice-review", title: "배포 고객 공지문 검토", kind: "meeting", subtype: "project_talk", date: "2026-09-29", start: "10:30", end: "11:00", room: "M1 확산", by: "jamoon", who: ["thkwon", "msjang", "desong", "jhyoon"], created: "2026-09-28 15:00" },
  { key: "search-focus", title: "검색 API 집중 작업", kind: "work", subtype: "focus", date: "2026-09-29", start: "13:00", end: "17:00", by: "dhkim", created: "2026-09-28 18:10" },
  { key: "rehearsal", title: "고객포털 배포 리허설", kind: "meeting", subtype: "project_talk", date: "2026-09-30", start: "14:00", end: "16:00", room: "C4 이끔", by: "sjoh", who: ["project:4", "sylee"], channel: "project:4", created: "2026-09-21 10:00", description: "스테이징에서 운영과 같은 순서로 · 이서연 검색 API 스모크 테스트 · 문제 나면 대시보드만 빼는 안" },
  { key: "filter-change", title: "공기청정기 필터 교체 입회", kind: "work", subtype: "project", date: "2026-09-30", start: "14:00", end: "15:00", location: "5층·6층", by: "mjgu", created: "2026-09-28 09:10" },
  { key: "founding", title: "창립 7주년 기념식", kind: "meeting", subtype: "meeting", date: "2026-10-01", start: "14:00", end: "15:00", room: "C1 상생", by: "yhno", who: ["all"], overflow: true, answers: { accepted: ["dhjung", "swhan", "tskim", "jhpark", "jwha", "mjgu", "hwcha"] }, created: "2026-09-16 10:00", description: "14:00 대표 말씀 · 14:15 5년 근속자 시상 · 14:30 케이크·기념품. 15시 이후 자유 퇴근" },
  { key: "freeze", title: "배포 동결", kind: "work", subtype: "deadline", date: "2026-10-01", allDay: true, by: "sjoh", who: ["project:4"], created: "2026-09-21 10:05" },
  { key: "freeze-duty", title: "배포 동결일 당번", kind: "work", subtype: "focus", date: "2026-10-01", start: "15:00", end: "19:00", by: "dyim", who: ["hekang"], created: "2026-09-28 11:00" },
  { key: "deploy", title: "고객포털 1차 배포", kind: "work", subtype: "deadline", date: "2026-10-02", start: "08:00", end: "12:00", room: "C4 이끔", by: "sjoh", who: ["project:4", "sylee"], channel: "project:4", created: "2026-09-21 10:10", description: "검색 개선·로그인 개선·대시보드 개편. 상황실 C4 이끔" },
  { key: "deploy-review", title: "1차 배포 결과 공유", kind: "meeting", subtype: "meeting", date: "2026-10-02", start: "16:00", end: "16:30", room: "C4 이끔", by: "sjoh", who: ["unit:dev", "yjshin", "thkwon"], created: "2026-09-30 10:00" },
  // 10/2 (금) 시연일 — 이서연(오후 내내 회의)·김도현·정하늘의 하루, 백엔드팀 부재 2건(대시보드 "오늘 팀 부재"), 회의실 8개가 고루 찬다
  { key: "half-dyim-1002", title: "오후 반차", kind: "leave", subtype: "half", date: "2026-10-02", start: "13:00", end: "18:00", by: "dyim", created: "2026-09-25 10:00" },
  { key: "gaon-aftercare", title: "가온물산 배포 후 현장 확인", kind: "outside", subtype: "site_visit", date: "2026-10-02", start: "14:00", end: "17:30", location: "가온물산 본사", by: "jhyoon", who: ["wjjeon"], created: "2026-09-29 17:10", description: "개편 검색·로그인 실사용 확인, 담당자 질문 받기" },
  { key: "yhno-jhpark-1on1", title: "노영훈·박지훈 1:1", kind: "meeting", subtype: "one_on_one", date: "2026-10-02", start: "09:00", end: "09:30", room: "M4 연구", by: "yhno", who: ["jhpark"], created: "2026-09-28 09:00" },
  { key: "finance-month-open", title: "재무팀 월초 결산 점검", kind: "meeting", subtype: "team_meeting", date: "2026-10-02", start: "09:00", end: "09:40", room: "M2 공유", by: "hwcha", who: ["unit:finance"], created: "2026-09-28 14:00", description: "9월 법인카드 마감분 확인 · 3분기 부가세 자료 진행" },
  { key: "sales-q4-kickoff", title: "영업사업부 4분기 킥오프", kind: "meeting", subtype: "meeting", date: "2026-10-02", start: "09:30", end: "11:00", room: "C1 상생", by: "tskim", who: ["unit:sales"], created: "2026-09-21 09:00", description: "3분기 실적 · 4분기 목표(신규 6곳·재계약 4곳) · 고객포털 개편 영업 포인트" },
  { key: "exec-q4-plan", title: "4분기 사업 계획 점검", kind: "meeting", subtype: "meeting", date: "2026-10-02", start: "10:00", end: "11:00", room: "C2 신뢰", by: "dhjung", who: ["swhan", "yhno"], created: "2026-09-25 18:00" },
  { key: "hr-eval-prep", title: "하반기 평가 설명회 자료 점검", kind: "meeting", subtype: "team_meeting", date: "2026-10-02", start: "10:00", end: "11:00", room: "M2 공유", by: "jhpark", who: ["jwha", "mjgu"], created: "2026-09-29 14:40", description: "10/8 팀장 설명회 자료 · 자기평가 양식 초안" },
  { key: "planning-triage", title: "고객 개선 요청 분류", kind: "meeting", subtype: "project_talk", date: "2026-10-02", start: "11:00", end: "12:00", room: "M3 가치", by: "sjhong", who: ["yjshin", "cwyang"], channel: "project:2", created: "2026-09-29 11:20", description: "#프로젝트-고객포털 요청 9월분 — 2차 배포 후보 고르기" },
  { key: "webinar-speakers", title: "웨비나 연사·순서 확정", kind: "meeting", subtype: "meeting", date: "2026-10-02", start: "11:00", end: "12:00", room: "M1 확산", by: "sbhwang", who: ["ebko", "shbaek", "gyyu"], created: "2026-09-29 17:20" },
  { key: "sclee-hnjung-1on1", title: "이상철·정하늘 1:1", kind: "meeting", subtype: "one_on_one", date: "2026-10-02", start: "11:00", end: "11:30", room: "M4 연구", by: "sclee", who: ["hnjung"], created: "2026-09-25 09:30", description: "미르건설 보안 인증 자료 진행 · 4분기 담당 고객" },
  { key: "deploy-monitor", title: "1차 배포 모니터링 점검", kind: "meeting", subtype: "project_talk", date: "2026-10-02", start: "13:00", end: "13:40", room: "C4 이끔", by: "dhkim", who: ["sylee", "hekang", "mhseo"], channel: "project:4", created: "2026-09-30 18:00", description: "오전 배포 뒤 오류율·응답 시간·고객 문의 확인" },
  { key: "security-edu-q4", title: "정보보안 정기 교육 (마케팅·경영지원)", kind: "meeting", subtype: "meeting", date: "2026-10-02", start: "13:00", end: "14:30", room: "C3 열정", by: "jhpark", who: ["unit:marketing", "mjgu", "yrjoo", "jysim"], created: "2026-09-22 10:00", description: "피싱 메일 사례 · 고객 자료 공유 규칙 · 노트북 잠금" },
  { key: "jmpark-msjang-1on1", title: "박정민·장민석 1:1", kind: "meeting", subtype: "one_on_one", date: "2026-10-02", start: "13:30", end: "14:00", room: "M4 연구", by: "jmpark", who: ["msjang"], created: "2026-09-28 11:00" },
  { key: "push-poc-check", title: "모바일앱 푸시 PoC 중간 점검", kind: "meeting", subtype: "project_talk", date: "2026-10-02", start: "14:00", end: "14:50", room: "M2 공유", by: "dhkim", who: ["sylee", "hekang"], channel: "project:1", created: "2026-09-30 10:30", description: "안드로이드 결과 · iOS 인증 키 연결 · 10/8 PR 범위" },
  { key: "hamil-q3-review", title: "해밀캐피탈 분기 리뷰 (고객 방문)", kind: "meeting", subtype: "meeting", date: "2026-10-02", start: "14:00", end: "15:00", room: "C2 신뢰", by: "sclee", who: ["ynchoi", "hnjung"], created: "2026-09-24 16:00", description: "고객사 담당자 2명 방문 · 3분기 사용 현황 · 추가 라이선스 20석 논의" },
  { key: "search-feedback", title: "검색 개선 고객 피드백 정리", kind: "meeting", subtype: "project_talk", date: "2026-10-02", start: "15:00", end: "15:45", room: "M1 확산", by: "msjang", who: ["dhkim", "sylee", "desong"], channel: "project:2", created: "2026-09-30 15:00", description: "배포 당일 고객사 문의 · 검색 결과 순서 요청" },
  { key: "portal-sales-edu", title: "고객포털 개편 기능 영업 교육", kind: "meeting", subtype: "meeting", date: "2026-10-02", start: "15:00", end: "16:00", room: "C3 열정", by: "jamoon", who: ["hnjung", "ynchoi", "sjhong"], created: "2026-09-29 16:30", description: "검색·로그인·대시보드 개편 — 고객에게 설명하는 법" },
  { key: "budget-qa", title: "2027 예산 템플릿 질의응답", kind: "meeting", subtype: "meeting", date: "2026-10-02", start: "15:00", end: "16:00", room: "M3 가치", by: "hwcha", who: ["yrjoo", "ebko", "jhpark"], created: "2026-09-29 10:00" },
  { key: "ux-flow-prereview", title: "모바일앱 화면 흐름도 사전 리뷰", kind: "meeting", subtype: "team_meeting", date: "2026-10-02", start: "16:00", end: "17:00", room: "M1 확산", by: "jmryu", who: ["syahn", "cwyang"], created: "2026-09-30 11:00" },
  { key: "webinar-pre-rehearsal", title: "웨비나 사전 리허설 (연사)", kind: "meeting", subtype: "meeting", date: "2026-10-02", start: "16:00", end: "17:30", room: "C1 상생", by: "ebko", who: ["shbaek", "gyyu", "sbhwang"], created: "2026-09-29 17:30" },
  { key: "dasom-terms", title: "다솜제약 재계약 조건 검토", kind: "meeting", subtype: "meeting", date: "2026-10-02", start: "16:00", end: "17:00", room: "C2 신뢰", by: "msjang", who: ["desong"], created: "2026-09-29 09:40" },
  { key: "sales1-weekly-wrap", title: "영업1팀 주간 정리", kind: "meeting", subtype: "team_meeting", date: "2026-10-02", start: "17:00", end: "17:40", room: "M2 공유", by: "sclee", who: ["unit:sales1"], created: "2026-09-25 09:40" },
  { key: "req-draft", title: "모바일앱 요구사항 초안 마감", kind: "work", subtype: "deadline", date: "2026-10-04", allDay: true, weekend: true, by: "jamoon", who: ["dhkim"], created: "2026-09-14 11:00" },
  // 10월 둘째 주
  { key: "checkup-jamoon", title: "건강검진", kind: "personal", subtype: "hospital", date: "2026-10-06", start: "08:00", end: "10:00", by: "jamoon", created: "2026-09-22 09:40" },
  { key: "mir-sec-review", title: "미르건설 보안 인증 자료 검토", kind: "meeting", subtype: "meeting", date: "2026-10-06", start: "10:00", end: "11:00", room: "M1 확산", by: "sclee", who: ["hnjung", "jhyoon", "dyim"], created: "2026-09-29 15:00" },
  { key: "mir-sec-due", title: "미르건설 보안 인증 자료 제출", kind: "work", subtype: "deadline", date: "2026-10-06", allDay: true, by: "sclee", who: ["hnjung", "ynchoi"], created: "2026-09-29 11:30" },
  { key: "bank-yrjoo", title: "은행 업무", kind: "personal", subtype: "errand", date: "2026-10-06", start: "12:00", end: "12:40", by: "yrjoo", created: "2026-09-29 17:00" },
  { key: "gaon-visit", title: "가온물산 고객포털 개편 안내 방문", kind: "outside", subtype: "client_visit", date: "2026-10-06", start: "13:30", end: "17:30", location: "가온물산 본사", by: "desong", who: ["wjjeon"], created: "2026-09-29 16:00" },
  { key: "dentist-dyim", title: "치과 진료", kind: "personal", subtype: "hospital", date: "2026-10-07", start: "12:00", end: "13:00", by: "dyim", created: "2026-09-23 10:00" },
  { key: "lunch-gyyu", title: "대학 동기 점심", kind: "personal", subtype: "meal", date: "2026-10-07", start: "12:00", end: "13:00", location: "회사 근처 쌀국숫집", visibility: "public", by: "gyyu", created: "2026-09-29 19:00" },
  { key: "interview-a", title: "백엔드 경력 1차 면접 (지원자 A)", kind: "meeting", subtype: "meeting", date: "2026-10-07", start: "14:00", end: "15:00", room: "M3 가치", by: "jwha", who: ["jhyoon", "dhkim"], answers: { accepted: ["jhyoon", "dhkim"] }, created: "2026-09-28 09:30", description: "면접관 윤재혁·김도현 · 과제 리뷰 20분 + 질의응답 40분" },
  { key: "sebom-visit", title: "새봄식품 정기 방문", kind: "outside", subtype: "client_visit", date: "2026-10-07", start: "14:00", end: "16:00", location: "새봄식품 본사", by: "wjjeon", who: ["msjang"], created: "2026-09-29 10:00" },
  { key: "interview-b", title: "백엔드 경력 1차 면접 (지원자 B)", kind: "meeting", subtype: "meeting", date: "2026-10-07", start: "15:30", end: "16:30", room: "M3 가치", by: "jwha", who: ["jhyoon", "dhkim"], answers: { accepted: ["jhyoon", "dhkim"] }, created: "2026-09-28 09:31", description: "면접관 윤재혁·김도현 · 과제 리뷰 20분 + 질의응답 40분" },
  { key: "interview-c", title: "백엔드 경력 1차 면접 (지원자 C)", kind: "meeting", subtype: "meeting", date: "2026-10-07", start: "17:00", end: "18:00", room: "M3 가치", by: "jwha", who: ["jhyoon", "dhkim"], answers: { accepted: ["jhyoon", "dhkim"] }, created: "2026-09-28 09:32", description: "면접관 윤재혁·김도현 · 과제 리뷰 20분 + 질의응답 40분" },
  { key: "eval-briefing", title: "하반기 평가 기준 설명회 (팀장)", kind: "meeting", subtype: "meeting", date: "2026-10-08", start: "10:00", end: "11:00", room: "C2 신뢰", by: "jhpark", who: ["jhyoon", "mhseo", "thkwon", "jmryu", "sclee", "msjang", "ebko", "hwcha", "jwha"], created: "2026-09-29 14:30", description: "평가 일정(자기평가 10/19~23 · 1차 10/26~30 · 2차 11/2~6)과 기준 설명" },
  { key: "eval-form-due", title: "자기평가 양식 초안 마감", kind: "work", subtype: "deadline", date: "2026-10-08", allDay: true, by: "jwha", who: ["jhpark"], created: "2026-09-29 14:15" },
  { key: "casebook-draft", title: "바른교육 사례집 시안 마감", kind: "work", subtype: "design", date: "2026-10-08", allDay: true, by: "syahn", who: ["ebko", "shbaek"], created: "2026-09-28 16:00" },
  { key: "interview-d", title: "백엔드 경력 1차 면접 (지원자 D)", kind: "meeting", subtype: "meeting", date: "2026-10-08", start: "15:30", end: "16:30", room: "M3 가치", by: "jwha", who: ["jhyoon", "dhkim"], answers: { accepted: ["jhyoon", "dhkim"] }, created: "2026-09-28 09:33", description: "면접관 윤재혁·김도현 · 과제 리뷰 20분 + 질의응답 40분" },
  { key: "interview-e", title: "백엔드 경력 1차 면접 (지원자 E)", kind: "meeting", subtype: "meeting", date: "2026-10-08", start: "17:00", end: "18:00", room: "M3 가치", by: "jwha", who: ["jhyoon", "dhkim"], answers: { accepted: ["jhyoon", "dhkim"] }, created: "2026-09-28 09:34", description: "면접관 윤재혁·김도현 · 과제 리뷰 20분 + 질의응답 40분" },
  // 10월 셋째 주
  { key: "onboarding-oct", title: "신규 입사자 온보딩 (마케팅팀 경력직)", kind: "meeting", subtype: "meeting", date: "2026-10-12", start: "10:00", end: "12:00", room: "C3 열정", by: "jwha", who: ["mjgu", "ebko"], created: "2026-09-28 10:30" },
  { key: "checkup-mhseo", title: "건강검진", kind: "personal", subtype: "hospital", date: "2026-10-13", start: "08:00", end: "10:00", by: "mhseo", created: "2026-09-29 13:00" },
  { key: "newsletter-oct", title: "10월 뉴스레터 발송", kind: "work", subtype: "deadline", date: "2026-10-13", start: "14:00", end: "14:30", by: "shbaek", who: ["gyyu", "ebko"], created: "2026-09-28 10:50" },
  { key: "casebook-print", title: "사례집 인쇄 발주", kind: "work", subtype: "deadline", date: "2026-10-13", allDay: true, by: "gyyu", who: ["shbaek"], created: "2026-09-28 11:00" },
  { key: "eval-notice", title: "하반기 평가 안내 공지", kind: "work", subtype: "deadline", date: "2026-10-13", allDay: true, by: "jhpark", who: ["jwha"], created: "2026-09-29 14:20" },
  { key: "half-hnjung-1013", title: "오후 반차", kind: "leave", subtype: "half", date: "2026-10-13", start: "13:00", end: "18:00", by: "hnjung", created: "2026-09-29 18:00" },
  { key: "birthday-jhpark", title: "아이 생일", kind: "personal", subtype: "anniversary", date: "2026-10-14", allDay: true, visibility: "private", by: "jhpark", created: "2026-09-01 09:00" },
  { key: "busan-trip", title: "부산 출장 — 누리유통 물류센터 방문", kind: "outside", subtype: "trip", date: "2026-10-14", until: "2026-10-15", allDay: true, location: "부산", by: "jmpark", who: ["sclee"], created: "2026-09-29 11:00" },
  { key: "dasom-sign", title: "다솜제약 재계약 서명", kind: "outside", subtype: "client_visit", date: "2026-10-14", start: "15:00", end: "16:00", location: "다솜제약 본사", by: "msjang", who: ["desong"], created: "2026-09-29 09:20" },
  { key: "yearend-due", title: "연말정산 사전 서류 마감", kind: "work", subtype: "deadline", date: "2026-10-15", allDay: true, by: "jwha", who: ["jhpark", "mjgu"], created: "2026-09-29 14:25" },
  { key: "checkup-sclee", title: "건강검진", kind: "personal", subtype: "hospital", date: "2026-10-16", start: "08:00", end: "10:00", by: "sclee", created: "2026-09-25 20:00" },
  { key: "budget-due", title: "2027 예산안 제출 마감", kind: "work", subtype: "deadline", date: "2026-10-16", allDay: true, by: "hwcha", who: ["yrjoo", "jysim", "yhno"], created: "2026-09-21 14:40" },
  { key: "leave-sylee-1016", title: "연차", kind: "leave", subtype: "annual", date: "2026-10-16", allDay: true, by: "sylee", created: "2026-09-21 14:40" },
  { key: "leave-dyim-1016", title: "연차", kind: "leave", subtype: "annual", date: "2026-10-16", allDay: true, by: "dyim", created: "2026-09-28 17:30" },
  { key: "brand-guide", title: "브랜드 가이드 개정 완료", kind: "work", subtype: "design", date: "2026-10-16", allDay: true, by: "jmryu", who: ["ebko"], created: "2026-09-17 15:00" },
  // 10월 넷째 주 이후
  { key: "self-eval", title: "하반기 자기평가 기간", kind: "work", subtype: "deadline", date: "2026-10-19", until: "2026-10-23", allDay: true, by: "jhpark", who: ["jwha", "mjgu"], created: "2026-09-29 14:35" },
  { key: "leave-cwyang-1019", title: "연차", kind: "leave", subtype: "annual", date: "2026-10-19", until: "2026-10-20", allDay: true, by: "cwyang", created: "2026-09-29 16:30" },
  { key: "checkup-gyyu", title: "건강검진", kind: "personal", subtype: "hospital", date: "2026-10-20", start: "08:00", end: "10:00", by: "gyyu", created: "2026-09-28 12:30" },
  { key: "anniv-msjang", title: "결혼기념일", kind: "personal", subtype: "anniversary", date: "2026-10-20", allDay: true, visibility: "private", by: "msjang", created: "2026-09-01 08:50" },
  { key: "webinar-rehearsal", title: "가을 웨비나 리허설", kind: "meeting", subtype: "meeting", date: "2026-10-20", start: "15:00", end: "16:00", room: "C1 상생", by: "ebko", who: ["sbhwang", "shbaek", "gyyu", "yjshin"], created: "2026-09-29 17:00" },
  { key: "webinar", title: "한결 오피스 가을 웨비나 (온라인)", kind: "meeting", subtype: "meeting", date: "2026-10-22", start: "14:00", end: "15:30", room: "C1 상생", by: "ebko", who: ["sbhwang", "shbaek", "gyyu", "yjshin", "tskim", "jmpark"], created: "2026-09-16 15:20", description: "1부 제품 로드맵·라이브 데모(신유진 이사) · 2부 바른교육 도입 사례. C1 상생에서 송출" },
  { key: "half-ysjo-1023", title: "오전 반차", kind: "leave", subtype: "half", date: "2026-10-23", start: "09:00", end: "13:00", by: "ysjo", created: "2026-09-29 18:30" },
  { key: "vat-due", title: "3분기 부가세 신고 준비 마감", kind: "work", subtype: "deadline", date: "2026-10-23", allDay: true, by: "yrjoo", who: ["hwcha"], created: "2026-09-21 15:00" },
  { key: "leave-thkwon-1026", title: "연차", kind: "leave", subtype: "annual", date: "2026-10-26", until: "2026-10-27", allDay: true, by: "thkwon", created: "2026-09-29 10:10" },
  { key: "checkup-jhyoon", title: "건강검진", kind: "personal", subtype: "hospital", date: "2026-10-27", start: "07:30", end: "09:30", by: "jhyoon", created: "2026-09-29 12:00" },
  { key: "townhall-q4", title: "4분기 전사 타운홀", kind: "meeting", subtype: "meeting", date: "2026-10-29", start: "16:00", end: "17:00", room: "C1 상생", by: "dhjung", who: ["all"], overflow: true, created: "2026-09-30 09:00", description: "3분기 실적과 4분기 목표 공유, 질의응답" },
  { key: "dev-dinner", title: "개발본부 배포 완료 회식", kind: "personal", subtype: "meal", date: "2026-10-30", start: "18:30", end: "21:00", location: "회사 근처 한식당", visibility: "public", by: "sjoh", who: ["unit:dev"], created: "2026-09-30 11:00" },
  { key: "leave-wjjeon-1030", title: "연차", kind: "leave", subtype: "annual", date: "2026-10-30", allDay: true, by: "wjjeon", created: "2026-09-29 09:00" },
];

// ── 펼치기 ──────────────────────────────────────────────────

const hash = (s) => createHash("sha1").update(s).digest("hex");
export const eventId = (key, date) => `0e000000-0000-4000-8001-${hash(`${key}|${date}`).slice(0, 12)}`;
const seriesId = (key) => `0f000000-0000-4000-8001-${hash(key).slice(0, 12)}`;
/** 시드 일정 id 범위 (--reset-events 가 이것만 지운다) */
export const SEED_EVENT_RANGE = ["0e000000-0000-0000-0000-000000000000", "0e000000-ffff-ffff-ffff-ffffffffffff"];

const kst = (date, hhmm) => new Date(`${date}T${hhmm}:00+09:00`);
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00+09:00`) + n * 86400e3).toISOString().slice(0, 10);
const weekday = (date) => new Date(`${date}T12:00:00+09:00`).getUTCDay();
const offDay = (date) => weekday(date) === 0 || weekday(date) === 6 || HOLIDAYS.has(date);
const handles = new Set(PEOPLE.map((p) => p.handle));
const joined = new Map(PEOPLE.map((p) => [p.handle, p.joined ?? "2000-01-01"]));

/** 그 날짜의 참석자 (토큰을 풀고, 입사 전인 사람은 뺀다). 만든 사람을 맨 앞에 */
function people(by, who, date, err) {
  const out = [];
  for (const w of who ?? []) {
    if (w === "all") out.push(...PEOPLE.map((p) => p.handle));
    else if (w.startsWith("unit:")) {
      const list = unitMembers(w.slice(5));
      if (!list.length) err(`없는 부서 ${w}`);
      out.push(...list);
    } else if (w.startsWith("project:")) {
      const list = channelMembers(w);
      if (!list) err(`없는 채널 ${w}`);
      out.push(...(list ?? []));
    } else {
      if (!handles.has(w)) err(`없는 사람 ${w}`);
      else if (joined.get(w) > date) err(`${w} 은 ${date} 에 아직 입사 전입니다`);
      out.push(w);
    }
  }
  const list = [...new Set([by, ...out])].filter((h) => handles.has(h) && joined.get(h) <= date);
  return list;
}

/** 일정 정의 하나를 회차 하나로 */
function occurrence(def, date, extra, err) {
  const allDay = !!def.allDay;
  const starts = allDay ? kst(date, "00:00") : kst(date, def.start);
  const ends = allDay ? kst(addDays(def.until && !def.repeat ? def.until : date, 1), "00:00") : kst(date, def.end);
  const created = def.created
    ? new Date(`${def.created.replace(" ", "T")}:00+09:00`)
    : new Date(kst(def.repeat ? def.from : date, "10:00").getTime() - 7 * 86400e3);
  return {
    id: eventId(def.key, date),
    key: def.key,
    date,
    title: def.title,
    kind: def.kind,
    subtype: def.subtype ?? null,
    description: def.description ?? null,
    starts,
    ends,
    allDay,
    room: def.room ?? null,
    location: def.location ?? null,
    visibility: def.visibility ?? (def.kind === "personal" ? "time_only" : "public"),
    channel: def.channel ?? null,
    by: def.by,
    who: people(def.by, def.who, date, err),
    answers: def.answers?.[date] ?? (def.repeat ? {} : (def.answers ?? {})),
    remind: def.remind,
    overflow: !!def.overflow,
    created: new Date(Math.min(created.getTime(), Date.now() - 60_000)),
    canceled: (def.cancel ?? []).includes(date),
    ...extra,
  };
}

/** 정의를 모두 펼쳐 회차 목록으로. 응답(참석자마다 response·responded_at·remind)까지 정한다 */
export async function loadSchedule() {
  const errors = [];
  const events = [];
  for (const def of [...SERIES, ...EVENTS]) {
    const err = (m) => errors.push(`${def.key}: ${m}`);
    if (!handles.has(def.by)) err(`없는 사람 ${def.by}`);
    if (!SUBTYPES[def.kind]?.includes(def.subtype)) err(`유형·세부 유형이 맞지 않습니다 (${def.kind}/${def.subtype})`);
    if (def.room && !ROOMS.some((r) => r.name === def.room)) err(`없는 회의실 ${def.room}`);
    if (def.channel && !channelMembers(def.channel)) err(`없는 채널 ${def.channel}`);
    if (!def.allDay && !(def.start < def.end)) err(`시각이 맞지 않습니다 (${def.start}~${def.end})`);
    if (def.title.length > 100 || (def.description ?? "").length > 2000) err("제목·설명이 너무 깁니다");
    if (def.location !== undefined && (!/\S/.test(def.location) || def.location.length > 100)) err("장소는 1~100자");
    if (def.repeat) {
      const sid = seriesId(def.key);
      for (let d = def.from; d <= def.until; d = addDays(d, 1)) {
        const hit =
          (def.repeat === "daily" && !offDay(d)) ||
          (def.repeat === "weekdays" && !offDay(d)) ||
          (def.repeat === "weekly" && weekday(d) === weekday(def.from) && !HOLIDAYS.has(d)) ||
          (def.repeat === "monthly" && d.slice(8) === def.from.slice(8) && !offDay(d));
        if (hit) events.push(occurrence(def, d, { seriesId: sid, recurrence: def.repeat }, err));
      }
      for (const d of def.cancel ?? []) if (!events.some((e) => e.key === def.key && e.date === d)) err(`취소할 회차가 없습니다 (${d})`);
    } else {
      if (offDay(def.date) && !def.weekend && def.kind !== "leave") err(`주말·공휴일입니다 (${def.date})`);
      events.push(occurrence(def, def.date, { seriesId: null, recurrence: null }, err));
    }
  }

  // 막는 일정: 휴가·외근·병원 등 개인 일정 (그 사람이 만든 것). 겹치는 회의에는 불참으로 답한다
  const blocks = events.filter(
    (e) => !e.canceled && (e.kind === "leave" || e.kind === "outside" || (e.kind === "personal" && e.subtype !== "anniversary")),
  );
  const blocked = (h, e) =>
    blocks.find((b) => b !== e && b.who.includes(h) && b.starts < e.ends && e.starts < b.ends && !(b.kind === "personal" && e.kind === "personal"));

  const now = Date.now();
  for (const e of events) {
    const past = e.ends.getTime() < now;
    const big = e.who.length > 15;
    e.attendees = e.who.map((h) => {
      let response;
      if (h === e.by) response = "accepted";
      else if (e.answers.declined?.includes(h)) response = "declined";
      else if (e.answers.accepted?.includes(h)) response = "accepted";
      else if (e.answers.pending?.includes(h)) response = "pending";
      else if (e.kind === "meeting" && !e.allDay && blocked(h, e)) response = "declined";
      else {
        // 전사 행사는 아무도 일부러 불참하지 않는다 (휴가로 겹치면 위에서 불참). 앞으로의 일정은 만든 지 오래될수록 많이 답했다
        const r = parseInt(hash(`${e.key}|${e.date}|${h}`).slice(0, 4), 16) % 100;
        const old = now - e.created.getTime() > 3 * 86400e3;
        if (big) response = past || r < 70 ? "accepted" : "pending";
        else if (past) response = r < 88 ? "accepted" : r < 97 ? "declined" : "pending";
        else if (old) response = r < 72 ? "accepted" : r < 82 ? "declined" : "pending";
        else response = r < 35 ? "accepted" : r < 42 ? "declined" : "pending";
      }
      const lag = (parseInt(hash(`${e.key}|${e.date}|${h}|t`).slice(0, 4), 16) % 36) * 3600e3;
      const responded =
        h === e.by
          ? e.created
          : response === "pending"
            ? null
            : new Date(Math.min(e.created.getTime() + lag + 600e3, e.starts.getTime(), now - 60_000));
      // 알림: 만든 사람은 화면 기본값(종일·휴가 없음, 개인·외근 1시간 전, 나머지 10분 전), 초대받은 사람은 10분 전 (종일이면 없음)
      const remind =
        e.remind ?? (e.allDay || e.kind === "leave" ? [] : h === e.by && (e.kind === "personal" || e.kind === "outside") ? [60] : [10]);
      return { handle: h, response, responded, remind };
    });
  }

  // 검사: 회의실 겹침·정원
  const live = events.filter((e) => !e.canceled);
  for (const e of live.filter((x) => x.room)) {
    const room = ROOMS.find((r) => r.name === e.room);
    const coming = e.attendees.filter((a) => a.response !== "declined").length;
    if (room && e.attendees.length > room.capacity && !e.overflow)
      errors.push(`${e.key} ${e.date}: ${e.room} 정원 ${room.capacity}명보다 많이 초대 (${e.attendees.length}명, 참석 예정 ${coming}명)`);
    for (const o of live) {
      if (o === e || o.room !== e.room || o.id < e.id) continue;
      if (o.starts < e.ends && e.starts < o.ends) errors.push(`${e.room} 겹침: ${e.key} ${e.date} ↔ ${o.key} ${o.date}`);
    }
  }
  // 검사: 한 사람이 같은 시각에 두 일정 (불참·종일·업무 마감/집중 시간은 빼고)
  const busy = (e) => !e.allDay && !(e.kind === "work" && (e.subtype === "deadline" || e.subtype === "focus" || e.subtype === "project"));
  for (const h of handles) {
    const mine = live.filter((e) => busy(e) && e.attendees.some((a) => a.handle === h && a.response !== "declined"));
    mine.sort((a, b) => a.starts - b.starts);
    for (let i = 1; i < mine.length; i++) {
      const [a, b] = [mine[i - 1], mine[i]];
      if (b.starts < a.ends) errors.push(`${h} 겹침: ${a.key} ${a.date} ${a.title} ↔ ${b.key} ${b.title}`);
    }
  }
  // 검사: 휴가·병원 시간에 그 사람이 대화하고 있지 않은지 (지난 일정만)
  const { messages } = await loadChats();
  for (const e of live.filter((x) => (x.kind === "leave" || x.subtype === "hospital") && x.starts.getTime() < now)) {
    const talk = messages.filter((m) => m.handle === e.by && m.at >= e.starts && m.at < e.ends);
    if (talk.length) errors.push(`${e.key}: ${e.by} 이 ${e.title} 중에 대화 ${talk.length}건 (${talk[0].channel} ${talk[0].at.toISOString()})`);
  }
  // 검사: 휴가인 사람이 만든 회의
  for (const e of live.filter((x) => x.kind === "meeting" && !x.allDay)) {
    const b = blocked(e.by, e);
    if (b && b.kind === "leave") errors.push(`${e.key} ${e.date}: 만든 사람 ${e.by} 이 그 시각에 ${b.title}`);
  }
  return { events, errors };
}

// 바로 실행하면 검사만 한다
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { events, errors } = await loadSchedule();
  const count = (f) => events.filter(f).length;
  const kinds = ["meeting", "work", "personal", "outside", "leave"].map((k) => `${k} ${count((e) => e.kind === k)}`).join(" · ");
  console.log(`회의실 ${ROOMS.length}개, 일정 ${events.length}건 (반복 ${SERIES.length}묶음 ${count((e) => e.seriesId)}회차, 취소 ${count((e) => e.canceled)}건)`);
  console.log(`유형: ${kinds} · 회의실 쓰는 일정 ${count((e) => e.room)}건 · 참석자 ${events.reduce((s, e) => s + e.attendees.length, 0)}명`);
  if (errors.length) {
    console.error(`\n오류 ${errors.length}개:\n` + errors.join("\n"));
    process.exit(1);
  }
  console.log("오류 없음");
}
