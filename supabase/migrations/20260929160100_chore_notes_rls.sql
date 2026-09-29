-- 잡무 수첩 RLS 켜기 (2026-09-29)
-- 20260929160000_chore_notes.sql 이 정책만 만들고 RLS 를 켜지 않았다. 꺼져 있으면 정책은 무시되고
-- 컬럼 권한만 남아서, 로그인한 누구나 모든 채널의 수첩을 읽고 고치고 지울 수 있었다 (check:chores 에서 발견).
-- 적용 전까지 수첩을 쓰는 화면은 배포되지 않았고, 테이블은 비어 있었다.

alter table public.chore_lists   enable row level security;
alter table public.chore_entries enable row level security;
