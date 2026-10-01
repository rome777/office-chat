-- Step 1 임시 호환 없애기 2단계 (2026-10-01, WU-21 — 1단계는 20261001200000_close_step1_anon).
-- 익명 쓰기를 닫았으니 Step 1 닉네임 칸 author 와 익명 메시지용 제약 messages_step1_anon 을 지운다.
-- 화면(채팅·스레드·알림·검색·대시보드·AI 요약/할 일)이 author 를 읽지 않게 바꾼 코드를 운영에 배포한 뒤에 적용한다
-- (먼저 지우면 author 를 select 하는 예전 운영 화면이 오류를 낸다).
-- 이제 메시지의 작성자는 user_id(로그인한 사람)뿐이고, 이름은 profiles 에서 찾는다.

alter table public.messages drop constraint if exists messages_step1_anon;
alter table public.messages drop column if exists author;
