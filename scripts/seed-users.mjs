// 시연 계정 만들기 (PRD 3절의 가상 인물). 가입 확인 메일 없이 바로 로그인할 수 있는 계정을 만든다.
// 실행: .env.local 에 SEED_PASSWORD=<비밀번호 8자 이상> 을 넣고 npm run seed:users
//
// 여러 번 돌려도 된다: 이미 있으면 비밀번호·이름·역할만 맞춘다. 비밀번호는 저장소·문서에 쓰지 않는다.
// 가입하면 트리거가 profiles 를 만들고 #일반 에 넣는다. 관리자는 profiles.role 을 admin 으로 바꾼다.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const password = process.env.SEED_PASSWORD;
if (!url || !serviceKey) {
  console.error("Supabase 환경 변수가 없습니다. npx vercel env pull .env.local 을 먼저 실행하세요.");
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error(".env.local 에 SEED_PASSWORD (8자 이상) 를 넣어 주세요. 모든 시연 계정이 이 비밀번호를 씁니다.");
  process.exit(1);
}

// 실명·실제 사내 정보는 쓰지 않는다 (example.com 은 예시용으로 예약된 도메인이라 실제 메일이 가지 않는다)
const PEOPLE = [
  { email: "a@example.com", handle: "userA", display_name: "사용자A", department: "개발팀", title: "매니저", role: "member" },
  { email: "b@example.com", handle: "userB", display_name: "사용자B", department: "개발팀", title: "사원", role: "member" },
  { email: "admin@example.com", handle: "admin", display_name: "관리자", department: "경영지원팀", title: "팀장", role: "admin" },
  { email: "c@example.com", handle: "userC", display_name: "비회원C", department: "영업팀", title: "사원", role: "member" },
];

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// 메일 주소로 기존 계정 찾기 (사람 수가 적어서 한 쪽이면 충분하다)
const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listError) throw listError;
const byEmail = new Map(list.users.map((u) => [u.email?.toLowerCase(), u]));

for (const p of PEOPLE) {
  const meta = { handle: p.handle, display_name: p.display_name, department: p.department, title: p.title };
  const found = byEmail.get(p.email);
  let id;
  if (found) {
    const { error } = await admin.auth.admin.updateUserById(found.id, {
      password,
      email_confirm: true,
      user_metadata: meta,
    });
    if (error) throw error;
    id = found.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true,
      user_metadata: meta,
    });
    if (error) throw error;
    id = data.user.id;
  }
  // 트리거가 만든 profiles 를 시연용 값으로 맞춘다 (handle 이 겹쳐 숫자가 붙었을 수 있다)
  const { error: pe } = await admin
    .from("profiles")
    .update({ handle: p.handle, display_name: p.display_name, department: p.department, title: p.title, role: p.role })
    .eq("id", id);
  if (pe) throw pe;
  console.log(`${found ? "갱신" : "생성"}  ${p.display_name.padEnd(6)} ${p.email}  @${p.handle}${p.role === "admin" ? "  (관리자)" : ""}`);
}
console.log("\n로그인: 위 메일 주소 + .env.local 의 SEED_PASSWORD");
