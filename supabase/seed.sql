-- 시연 데이터 (WU-07). 여러 번 돌려도 같은 결과가 되게 쓴다 (이미 있으면 건너뛴다).
-- 실명·실제 사내 정보는 넣지 않는다.
--
-- 여기에는 회의실만 있다 (2026-09-29, 캘린더 DB 연결 때 ② 가 넣음). 계정은 비밀번호가 필요해 SQL 로 만들 수 없어서,
-- 시연 회사(조직·직원·부서 채널·프로젝트 채널·샘플 대화·샘플 회의)는 npm run seed:company (scripts/seed-company.mjs) 가 만든다.
-- 그 스크립트도 같은 회의실을 넣는다.
--
-- 회의실을 지워도 그 회의실을 쓰던 회의는 지워지지 않는다 (events.room_id 가 on delete set null → "회의실 없음").

insert into public.rooms (name, capacity, location) values
  ('회의실 1 (소)', 4, '3층'),
  ('회의실 2 (중)', 8, '3층'),
  ('회의실 3 (대)', 16, '5층')
on conflict (name) do nothing;
