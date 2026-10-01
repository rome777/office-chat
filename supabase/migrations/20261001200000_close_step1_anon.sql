-- Step 1 임시 호환 없애기 1단계 (2026-10-01, 전체 통과 테스트 WU-21)
-- 파일 번호: 처음 20261001190000 으로 올렸으나 같은 번호(20261001190000_rooms_policy_fix)가 이미 원격에 적용·기록돼 있어
--   CLI 가 이 파일을 적용된 것으로 보고 건너뛰므로 20261001200000 으로 바꿨다 (2026-10-01, 김송이 — 내용은 그대로).
--
-- 20260929100100_step1_compat.sql 이 운영에 그대로 남아 있었다. 로그인하지 않은 사람(anon)이 공개 키만으로
--   · #일반 메시지를 모두 읽고 (2026-10-01 71건)
--   · author 칸에 아무 이름이나 넣어 #일반 에 쓸 수 있었다.
-- 화면은 author 를 작성자 이름으로 보여 줘서, 시험으로 넣은 "정대현" 글이 정대현이 쓴 것처럼 보였다 (바로 지움).
-- FINAL_CHECKLIST 2절 "작성자는 로그인 정보로 정해진다 (다른 사람 이름으로 보낼 수 없다)" 에 걸린다.
--
-- 이 파일이 하는 것: anon 정책 두 개와 anon 권한을 없애고, user_id 를 다시 필수로, channel_id 기본값(#일반)을 없앤다.
-- 남긴 것: author 칸과 messages_step1_anon 제약 — 지금 운영 화면 코드가 author 를 읽는다.
--   새 화면 코드를 배포한 뒤 다음 파일에서 지운다 (TECH_SPEC 13절 "Step 1 임시 호환").
-- #일반 채널은 그대로 둔다 (모든 직원이 멤버인 회사 채널).

drop policy if exists "step1: 익명은 #일반만 조회" on public.messages;
drop policy if exists "step1: 익명은 #일반에만 쓰기" on public.messages;
revoke insert (client_id, author, body) on public.messages from anon;
revoke all on public.messages from anon;

-- 익명 메시지는 0건이다 (2026-10-01 확인). 그사이 생겼으면 지운다 — 거기 달린 스레드 답글도 함께 지워진다
delete from public.messages where user_id is null;

alter table public.messages alter column user_id set not null;
alter table public.messages alter column channel_id drop default;
