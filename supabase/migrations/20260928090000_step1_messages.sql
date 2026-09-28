-- Step 1: 단일 채널(#일반) 메시지.
-- 로그인이 없는 단계라 anon 이 읽고 쓸 수 있다. Step 2 에서 로그인·채널·멤버십 정책으로 바꾼다.

create table public.messages (
  id         bigint generated always as identity primary key,
  client_id  uuid        not null unique,           -- 멱등 전송: 같은 client_id 는 한 번만 저장
  author     text        not null,
  body       text        not null,
  created_at timestamptz not null default now(),
  constraint messages_author_len check (author ~ '\S' and char_length(author) <= 20),
  constraint messages_body_len   check (body ~ '\S' and char_length(body) <= 2000)
);

alter table public.messages enable row level security;

create policy "step1: 누구나 읽기" on public.messages
  for select to anon, authenticated using (true);

create policy "step1: 누구나 쓰기" on public.messages
  for insert to anon, authenticated with check (true);

-- id·created_at 은 서버가 정한다. 클라이언트는 세 컬럼만 넣을 수 있다.
revoke insert, update, delete on public.messages from anon, authenticated;
grant insert (client_id, author, body) on public.messages to anon, authenticated;

-- 실시간 구독 대상에 추가
alter publication supabase_realtime add table public.messages;
