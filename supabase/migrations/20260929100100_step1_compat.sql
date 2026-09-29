-- Step 1 임시 호환 (2026-09-29). ── 로그인 작업(WU-03)이 끝나면 되돌린다 ──
--
-- DB v1 을 적용해도 배포된 Step 1 화면(로그인 없이 닉네임으로 #일반 에서 대화)이 계속 돌게 한다.
-- 익명(anon)은 #일반 채널 하나만 읽고 쓸 수 있고, 작성자는 user_id 대신 author(닉네임)로 남는다.
--
-- 되돌릴 때 할 일 (새 마이그레이션으로):
--   1. anon 정책 두 개와 anon 권한을 없앤다
--   2. 익명 메시지(user_id is null)를 지우거나 따로 옮긴다
--   3. messages_step1_anon 제약과 author 컬럼을 없애고, user_id 를 not null 로, channel_id 기본값을 없앤다
--   #일반 채널은 남겨도 된다 (전사 공지용 공개 채널)

-- #일반 채널. id 를 고정해 둔다 (Step 1 화면은 채널을 모르고 이 채널에만 쓴다)
insert into public.channels (id, name, type, created_by)
values ('00000000-0000-0000-0000-000000000001', '일반', 'public', null);

alter table public.messages alter column user_id drop not null;
alter table public.messages alter column channel_id set default '00000000-0000-0000-0000-000000000001';
alter table public.messages add column author text;  -- Step 1 닉네임. 로그인한 사람의 메시지는 비운다
alter table public.messages add constraint messages_step1_anon check (
  user_id is not null
  or (
    channel_id = '00000000-0000-0000-0000-000000000001'
    and author ~ '\S' and char_length(author) <= 20
    and body ~ '\S'  -- 빈 메시지는 23514 로 거부한다 (Step 1 과 같은 오류 코드)
  )
);

-- Step 1 메시지를 id 그대로 옮긴다. 열려 있던 화면이 "마지막 id 이후"로 이어 받을 수 있게 번호도 이어 간다
insert into public.messages (id, client_id, channel_id, author, body, created_at)
overriding system value
select id, client_id, '00000000-0000-0000-0000-000000000001', author, body, created_at
from public.step1_messages;
select setval(
  pg_get_serial_sequence('public.messages', 'id'),
  coalesce((select max(id) from public.messages), 0) + 1,
  false
);
drop table public.step1_messages;

-- 익명은 #일반 만. id·created_at·user_id·channel_id 는 보낼 수 없다 (컬럼 권한)
grant select on public.messages to anon;
grant insert (client_id, author, body) on public.messages to anon;
create policy "step1: 익명은 #일반만 조회" on public.messages
  for select to anon using (channel_id = '00000000-0000-0000-0000-000000000001');
create policy "step1: 익명은 #일반에만 쓰기" on public.messages
  for insert to anon with check (channel_id = '00000000-0000-0000-0000-000000000001' and user_id is null);
