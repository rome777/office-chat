-- DB v1 (WU-02, 2026-09-29): TECH_SPEC 4·5절의 테이블 13개, 인덱스, 확장, RLS, 함수.
--
-- Step 1 의 messages 는 step1_messages 로 이름만 바꿔 두고 새로 만든다.
-- 옛 메시지를 옮기는 것과 로그인 없이 #일반 을 쓰는 임시 권한은 다음 파일(20260929100100_step1_compat.sql)이 한다.
-- 알림을 만드는 트리거(멘션·스레드 답글·DM·일정)와 10분 전 알림 pg_cron 작업은 알림 작업(③)에서 추가한다.
--
-- 권한 원칙: 테이블마다 anon·authenticated 권한을 모두 거둔 뒤, 필요한 컬럼만 다시 준다.
-- 그래서 클라이언트는 user_id·created_by·role 같은 컬럼을 아예 보낼 수 없다 (보내면 42501).
-- 정책끼리 서로를 조회하면 무한 재귀가 나므로, 멤버·참석자 확인은 security definer 함수로 한다.

-- ─── 확장 ─────────────────────────────────────────────
create extension if not exists pg_trgm with schema extensions;    -- 검색
create extension if not exists btree_gist with schema extensions; -- 회의실 이중 예약 금지 제약
create extension if not exists pg_cron with schema pg_catalog;    -- 10분 전 알림 (Supabase 는 pg_catalog 에 둔다)
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- ─── Step 1 테이블은 이름을 바꿔 둔다 ─────────────────
alter publication supabase_realtime drop table public.messages;
alter table public.messages rename to step1_messages;
alter index public.messages_pkey rename to step1_messages_pkey;
alter index public.messages_client_id_key rename to step1_messages_client_id_key;
alter sequence public.messages_id_seq rename to step1_messages_id_seq;
drop policy "step1: 누구나 읽기" on public.step1_messages;
drop policy "step1: 누구나 쓰기" on public.step1_messages;
revoke all on public.step1_messages from anon, authenticated;

-- ─── 테이블 ──────────────────────────────────────────

-- 사람. 가입하면 트리거가 만든다. role 은 본인이 못 바꾼다 (컬럼 권한)
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  handle       text not null,                          -- 멘션용 (@handle)
  display_name text not null,
  department   text,
  title        text,
  role         text not null default 'member' check (role in ('admin', 'member')),
  created_at   timestamptz not null default now(),
  -- 멘션 강조(components/chat/SafeText)와 같은 글자만 쓴다
  constraint profiles_handle_format check (handle ~ '^[A-Za-z0-9_가-힣-]{1,20}$'),
  constraint profiles_display_name_len check (display_name ~ '\S' and char_length(display_name) <= 40)
);
create unique index profiles_handle_lower_key on public.profiles (lower(handle));

-- 대화방. DM 은 멤버 2명인 채널이고 create_dm() 으로만 만든다
create table public.channels (
  id         uuid primary key default gen_random_uuid(),
  name       text,                                     -- DM 은 비운다 (화면이 상대 이름을 보여 준다)
  type       text not null check (type in ('public', 'private', 'dm')),
  dm_key     text unique,                              -- 두 사용자 id 를 정렬해 이은 값
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint channels_dm_key check ((type = 'dm') = (dm_key is not null)),
  constraint channels_name check (type = 'dm' or (name ~ '\S' and char_length(name) <= 40))
);

create table public.memberships (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- 순서는 id 로 정한다 (시각은 같을 수 있다). parent_id 가 있으면 스레드 답글 (한 단계만)
create table public.messages (
  id         bigint generated always as identity primary key,
  client_id  uuid not null unique,                     -- 멱등 전송: 같은 client_id 는 한 번만 저장
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id),
  parent_id  bigint references public.messages (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz,
  -- 빈 본문은 클라이언트 쓰기 정책이 막는다. 첨부만 있는 메시지는 서버(service role)가 빈 본문으로 넣을 수 있게 둔다
  constraint messages_body_len check (char_length(body) <= 2000)
);
create index messages_channel_id_idx on public.messages (channel_id, id desc);
create index messages_parent_idx on public.messages (parent_id) where parent_id is not null;
create index messages_body_trgm_idx on public.messages using gin (body extensions.gin_trgm_ops);

-- 첨부. 행은 서버 API 만 만든다 (시그니처 검사 뒤). 파일은 비공개 버킷 attachments 의 {channel_id}/{uuid}-{파일이름}
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   bigint not null references public.messages (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  storage_path text not null unique,
  mime         text not null check (mime in ('image/png', 'image/jpeg', 'application/pdf')),
  size         integer not null check (size between 1 and 5242880),
  file_name    text not null check (char_length(file_name) between 1 and 200),
  created_at   timestamptz not null default now()
);
create index attachments_message_idx on public.attachments (message_id);

-- 읽음 위치. 안 읽은 사람 수 계산에 쓰므로 같은 채널 멤버가 읽을 수 있다. 뒤로 가지 않는다 (트리거)
create table public.read_positions (
  channel_id           uuid not null references public.channels (id) on delete cascade,
  user_id              uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  last_read_message_id bigint not null default 0,
  updated_at           timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table public.rooms (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  capacity integer check (capacity > 0),
  location text
);

-- 회의. 지우지 않고 canceled_at 으로 취소한다. 취소한 회의는 회의실 자리를 비운다
create table public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (title ~ '\S' and char_length(title) <= 100),
  description text check (char_length(description) <= 2000),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  room_id     uuid references public.rooms (id) on delete set null,
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  canceled_at timestamptz,
  constraint events_time check (ends_at > starts_at),
  -- '[)' 라서 10:00~11:00 과 11:00~12:00 은 겹치지 않는다. 두 사람이 동시에 넣어도 하나만 성공한다
  constraint events_no_double_booking exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (room_id is not null and canceled_at is null)
);
create index events_starts_idx on public.events (starts_at);

create table public.event_attendees (
  event_id     uuid not null references public.events (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  response     text not null default 'pending' check (response in ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  primary key (event_id, user_id)
);
create index event_attendees_user_idx on public.event_attendees (user_id);

-- 알림. 본문은 저장하지 않는다 (미리보기는 messages 를 RLS 로 읽는다). 생성은 DB 트리거만 한다
create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null check (type in (
               'dm', 'mention', 'thread_reply',
               'event_invite', 'event_update', 'event_cancel', 'event_reminder')),
  channel_id uuid references public.channels (id) on delete cascade,
  message_id bigint references public.messages (id) on delete cascade,
  event_id   uuid references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  -- 메시지 알림은 message_id·channel_id, 일정 알림은 event_id 만 채운다
  constraint notifications_target check (
    case when type in ('dm', 'mention', 'thread_reply')
      then message_id is not null and channel_id is not null and event_id is null
      else event_id is not null and message_id is null
    end),
  -- 한 메시지로 한 사람에게 하나 (DM 안의 멘션, 재전송 포함)
  constraint notifications_one_per_message unique (user_id, message_id)
);
-- 초대·10분 전 알림은 한 번만 (pg_cron 이 1분마다 돌아도)
create unique index notifications_one_per_event on public.notifications (user_id, event_id, type)
  where type in ('event_invite', 'event_reminder');
create index notifications_user_idx on public.notifications (user_id, id desc);

-- AI 할 일. 사용자가 승인했을 때만 저장한다. 담당자·기한이 null 이면 "미정"
create table public.todos (
  id                  uuid primary key default gen_random_uuid(),
  channel_id          uuid not null references public.channels (id) on delete cascade,
  created_by          uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  task                text not null check (task ~ '\S' and char_length(task) <= 500),
  assignee            uuid references public.profiles (id) on delete set null,
  due                 date,
  evidence_message_id bigint references public.messages (id) on delete set null,
  created_at          timestamptz not null default now(),
  done_at             timestamptz
);
create index todos_channel_idx on public.todos (channel_id, created_at desc);

-- 관리 작업 기록. 트리거만 쓴다
create table public.admin_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  target     jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- AI 요청량·비용 (제출용). 요청 상한도 이것을 세어서 검사한다
create table public.ai_usage_logs (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  feature       text not null check (feature in ('summarize', 'todos', 'tone')),
  input_tokens  integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd      numeric(12, 6) not null default 0 check (cost_usd >= 0),
  status        text not null check (status in ('ok', 'error', 'timeout', 'rate_limited', 'denied')),
  created_at    timestamptz not null default now()
);
create index ai_usage_logs_user_idx on public.ai_usage_logs (user_id, created_at desc);

-- ─── 정책에서 쓰는 확인 함수 ─────────────────────────
-- security definer 라 RLS 를 거치지 않고 조회한다 → 정책이 서로를 불러도 재귀하지 않는다

create function public.is_member(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where channel_id = p_channel and user_id = (select auth.uid())
  );
$$;

create function public.channel_type(p_channel uuid) returns text
language sql stable security definer set search_path = '' as $$
  select type from public.channels where id = p_channel;
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create function public.is_event_participant(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events where id = p_event and created_by = (select auth.uid()))
      or exists (select 1 from public.event_attendees where event_id = p_event and user_id = (select auth.uid()));
$$;

create function public.is_event_owner(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events where id = p_event and created_by = (select auth.uid()));
$$;

-- ─── RLS 와 컬럼 권한 ────────────────────────────────

alter table public.profiles        enable row level security;
alter table public.channels        enable row level security;
alter table public.memberships     enable row level security;
alter table public.messages        enable row level security;
alter table public.attachments     enable row level security;
alter table public.read_positions  enable row level security;
alter table public.rooms           enable row level security;
alter table public.events          enable row level security;
alter table public.event_attendees enable row level security;
alter table public.notifications   enable row level security;
alter table public.todos           enable row level security;
alter table public.admin_logs      enable row level security;
alter table public.ai_usage_logs   enable row level security;

revoke all on
  public.profiles, public.channels, public.memberships, public.messages, public.attachments,
  public.read_positions, public.rooms, public.events, public.event_attendees, public.notifications,
  public.todos, public.admin_logs, public.ai_usage_logs
from anon, authenticated;

-- profiles: 로그인한 사람은 모두 조회 (조직도 검색). 본인은 이름·부서·직함·handle 만 고친다
grant select on public.profiles to authenticated;
grant update (handle, display_name, department, title) on public.profiles to authenticated;
create policy "로그인 사용자는 모두 조회" on public.profiles
  for select to authenticated using (true);
create policy "본인만 수정" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- channels: 공개는 모두, 비공개·DM 은 멤버만. 관리자는 비공개 채널도 본다 (멤버를 넣어야 하므로). DM 은 관리자도 못 본다
grant select on public.channels to authenticated;
grant insert (name, type) on public.channels to authenticated;
create policy "공개 채널·내 채널 조회" on public.channels
  for select to authenticated using (
    type = 'public'
    or created_by = (select auth.uid())  -- 방금 만든 비공개 채널을 insert ... returning 으로 돌려받으려면 필요하다
    or public.is_member(id)
    or (type = 'private' and public.is_admin())
  );
create policy "공개·비공개 채널 만들기" on public.channels
  for insert to authenticated with check (type in ('public', 'private') and created_by = (select auth.uid()));

-- memberships: 같은 채널 멤버끼리 조회. 공개 채널은 본인이 가입. 비공개 채널 추가와 남을 빼는 것은 관리자만
grant select, delete on public.memberships to authenticated;
grant insert (channel_id, user_id) on public.memberships to authenticated;
create policy "같은 채널 멤버 조회" on public.memberships
  for select to authenticated using (
    user_id = (select auth.uid())
    or public.is_member(channel_id)
    or (public.is_admin() and public.channel_type(channel_id) <> 'dm')
  );
create policy "공개 채널 가입, 관리자는 추가" on public.memberships
  for insert to authenticated with check (
    (user_id = (select auth.uid()) and public.channel_type(channel_id) = 'public')
    or (public.is_admin() and public.channel_type(channel_id) in ('public', 'private'))
  );
create policy "본인 나가기, 관리자는 제거" on public.memberships
  for delete to authenticated using (
    public.channel_type(channel_id) <> 'dm'
    and (user_id = (select auth.uid()) or public.is_admin())
  );

-- messages: 멤버만 읽고 쓴다. 작성자는 기본값 auth.uid() 로만 정해진다 (user_id 컬럼 권한이 없다)
grant select on public.messages to authenticated;
grant insert (client_id, channel_id, parent_id, body) on public.messages to authenticated;
grant update (body, deleted_at) on public.messages to authenticated;
create policy "멤버만 조회" on public.messages
  for select to authenticated using (public.is_member(channel_id));
create policy "멤버만 본인 이름으로 쓰기" on public.messages
  for insert to authenticated with check (
    user_id = (select auth.uid()) and public.is_member(channel_id) and body ~ '\S'
  );
create policy "본인 것만 수정·삭제" on public.messages
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- attachments: 멤버만 조회. 쓰기는 서버 API(service role)만
grant select on public.attachments to authenticated;
create policy "멤버만 조회" on public.attachments
  for select to authenticated using (public.is_member(channel_id));

-- read_positions: 같은 채널 멤버가 조회 (안 읽은 사람 수). 본인 행만 쓴다
grant select on public.read_positions to authenticated;
grant insert (channel_id, last_read_message_id) on public.read_positions to authenticated;
grant update (last_read_message_id) on public.read_positions to authenticated;
create policy "같은 채널 멤버 조회" on public.read_positions
  for select to authenticated using (public.is_member(channel_id));
create policy "본인 행만 추가" on public.read_positions
  for insert to authenticated with check (user_id = (select auth.uid()) and public.is_member(channel_id));
create policy "본인 행만 수정" on public.read_positions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_member(channel_id));

-- rooms: 로그인 사용자 모두 조회, 관리자만 쓰기
grant select, insert, update, delete on public.rooms to authenticated;
create policy "로그인 사용자 조회" on public.rooms
  for select to authenticated using (true);
create policy "관리자만 추가" on public.rooms
  for insert to authenticated with check (public.is_admin());
create policy "관리자만 수정" on public.rooms
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "관리자만 삭제" on public.rooms
  for delete to authenticated using (public.is_admin());

-- events: 만든 사람과 참석자만 조회. 만든 사람만 수정·취소. 삭제 없음
-- 회의실 빈 시간은 room_busy() 로만 본다 (남의 회의 제목·참석자가 새지 않게)
grant select on public.events to authenticated;
grant insert (title, description, starts_at, ends_at, room_id) on public.events to authenticated;
grant update (title, description, starts_at, ends_at, room_id, canceled_at) on public.events to authenticated;
create policy "만든 사람·참석자 조회" on public.events
  for select to authenticated using (created_by = (select auth.uid()) or public.is_event_participant(id));
create policy "로그인 사용자 만들기" on public.events
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "만든 사람만 수정·취소" on public.events
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

-- event_attendees: 그 회의의 만든 사람과 참석자가 조회. 추가·삭제는 만든 사람만. 본인은 응답만 고친다
grant select, delete on public.event_attendees to authenticated;
grant insert (event_id, user_id) on public.event_attendees to authenticated;
grant update (response) on public.event_attendees to authenticated;
create policy "회의 참여자 조회" on public.event_attendees
  for select to authenticated using (public.is_event_participant(event_id));
create policy "만든 사람만 추가" on public.event_attendees
  for insert to authenticated with check (public.is_event_owner(event_id));
create policy "만든 사람만 삭제" on public.event_attendees
  for delete to authenticated using (public.is_event_owner(event_id));
create policy "본인 응답만 수정" on public.event_attendees
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- notifications: 본인만 조회, read_at 만 고친다. 생성은 트리거만
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "본인만 조회" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "본인만 읽음 표시" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- todos: 채널 멤버가 조회·완료 표시. 저장은 승인한 본인 이름으로, 근거 메시지는 같은 채널 것만
grant select, delete on public.todos to authenticated;
grant insert (channel_id, task, assignee, due, evidence_message_id) on public.todos to authenticated;
grant update (done_at) on public.todos to authenticated;
create policy "멤버만 조회" on public.todos
  for select to authenticated using (public.is_member(channel_id));
create policy "멤버가 승인해서 저장" on public.todos
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and public.is_member(channel_id)
    and (evidence_message_id is null or exists (
      select 1 from public.messages m where m.id = evidence_message_id and m.channel_id = todos.channel_id))
  );
create policy "멤버가 완료 표시" on public.todos
  for update to authenticated using (public.is_member(channel_id)) with check (public.is_member(channel_id));
create policy "만든 사람만 삭제" on public.todos
  for delete to authenticated using (created_by = (select auth.uid()));

-- admin_logs: 관리자만 조회. 쓰기는 트리거만
grant select on public.admin_logs to authenticated;
create policy "관리자만 조회" on public.admin_logs
  for select to authenticated using (public.is_admin());

-- ai_usage_logs: 본인 것만 조회·기록 (서버 API 가 사용자 토큰으로 넣는다)
grant select on public.ai_usage_logs to authenticated;
grant insert (feature, input_tokens, output_tokens, cost_usd, status) on public.ai_usage_logs to authenticated;
create policy "본인만 조회" on public.ai_usage_logs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "본인 이름으로 기록" on public.ai_usage_logs
  for insert to authenticated with check (user_id = (select auth.uid()));

-- ─── 트리거 ──────────────────────────────────────────

-- 가입하면 profiles 를 만든다. handle 은 가입 정보(raw_user_meta_data.handle) → 메일 앞부분 순으로 정하고, 겹치면 숫자를 붙인다.
-- role 은 가입 정보로 정하지 않는다 (누구나 admin 으로 가입할 수 있게 되므로)
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  base text;
  candidate text;
  n integer := 0;
begin
  base := coalesce(nullif(new.raw_user_meta_data ->> 'handle', ''), split_part(coalesce(new.email, ''), '@', 1));
  base := left(regexp_replace(base, '[^A-Za-z0-9_가-힣-]', '', 'g'), 16);
  if base = '' then
    base := 'user';
  end if;
  candidate := base;
  while exists (select 1 from public.profiles where lower(handle) = lower(candidate)) loop
    n := n + 1;
    candidate := base || n::text;
  end loop;

  insert into public.profiles (id, handle, display_name, department, title)
  values (
    new.id,
    candidate,
    coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'display_name'), 40), ''), candidate),
    nullif(btrim(new.raw_user_meta_data ->> 'department'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'title'), '')
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 채널을 만든 사람은 그 채널 멤버가 된다
create function public.channels_add_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is not null then
    insert into public.memberships (channel_id, user_id) values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger channels_add_creator
  after insert on public.channels
  for each row execute function public.channels_add_creator();

-- 답글은 같은 채널의 최상위 메시지에만 단다 (스레드는 한 단계)
create function public.messages_check_parent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  parent record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select channel_id, parent_id into parent from public.messages where id = new.parent_id;
  if not found or parent.channel_id <> new.channel_id or parent.parent_id is not null then
    raise exception '답글은 같은 채널의 최상위 메시지에만 달 수 있습니다' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger messages_check_parent
  before insert on public.messages
  for each row execute function public.messages_check_parent();

create function public.messages_touch_edited() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
create trigger messages_touch_edited
  before update on public.messages
  for each row execute function public.messages_touch_edited();

-- 읽음 위치는 뒤로 가지 않는다 (탭 두 개가 서로 다른 위치를 보내도)
create function public.read_positions_forward() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.last_read_message_id := greatest(old.last_read_message_id, new.last_read_message_id);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger read_positions_forward
  before insert or update on public.read_positions
  for each row execute function public.read_positions_forward();

create function public.events_touch_updated() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger events_touch_updated
  before update on public.events
  for each row execute function public.events_touch_updated();

create function public.event_attendees_touch_response() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.response is distinct from old.response then
    new.responded_at := now();
  end if;
  return new;
end;
$$;
create trigger event_attendees_touch_response
  before update on public.event_attendees
  for each row execute function public.event_attendees_touch_response();

-- 남을 채널에 넣거나 빼면 관리 기록에 남긴다 (본인 가입·나가기, DM, 시드·서버 작업은 빼고)
create function public.memberships_log_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  row_data public.memberships;
begin
  if tg_op = 'DELETE' then
    row_data := old;
  else
    row_data := new;
  end if;
  -- 채널을 통째로 지울 때는 채널이 먼저 사라져 type 이 null 이다 → 기록하지 않는다
  if actor is null or actor = row_data.user_id
     or coalesce((select type from public.channels where id = row_data.channel_id), 'dm') = 'dm' then
    return null;
  end if;
  insert into public.admin_logs (actor_id, action, target)
  values (
    actor,
    case when tg_op = 'DELETE' then 'remove_member' else 'add_member' end,
    jsonb_build_object('channel_id', row_data.channel_id, 'user_id', row_data.user_id)
  );
  return null;
end;
$$;
create trigger memberships_log_admin
  after insert or delete on public.memberships
  for each row execute function public.memberships_log_admin();

-- ─── 함수 (클라이언트가 rpc 로 부른다) ───────────────

-- DM 시작. 같은 두 사람은 몇 번 불러도 채널이 하나다 (dm_key 유일 제약)
create function public.create_dm(other_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  key text;
  channel uuid;
begin
  if me is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;
  if other_user_id = me or not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'DM 상대가 올바르지 않습니다' using errcode = '22023';
  end if;

  key := least(me::text, other_user_id::text) || ':' || greatest(me::text, other_user_id::text);
  insert into public.channels (type, dm_key, created_by)
  values ('dm', key, me)
  on conflict (dm_key) do nothing
  returning id into channel;
  if channel is null then
    select id into channel from public.channels where dm_key = key;
  end if;

  insert into public.memberships (channel_id, user_id)
  values (channel, me), (channel, other_user_id)
  on conflict do nothing;
  return channel;
end;
$$;

-- 회의 만들기. 회의 한 행과 참석자 여러 행을 한 번에 넣는다. 만든 사람은 accepted 로 들어간다.
-- 회의실이 겹치면 events_no_double_booking 제약 오류(23P01)가 난다 → 화면에서 "이미 예약된 시간입니다"
create function public.create_event(
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_room_id uuid default null,
  p_attendee_ids uuid[] default '{}',
  p_description text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  event uuid;
begin
  if me is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  insert into public.events (title, description, starts_at, ends_at, room_id, created_by)
  values (p_title, p_description, p_starts_at, p_ends_at, p_room_id, me)
  returning id into event;

  insert into public.event_attendees (event_id, user_id, response, responded_at)
  values (event, me, 'accepted', now());

  insert into public.event_attendees (event_id, user_id)
  select event, p.id
  from public.profiles p
  where p.id = any (coalesce(p_attendee_ids, '{}')) and p.id <> me
  on conflict do nothing;
  return event;
end;
$$;

-- 회의실 예약 현황. 시작·끝 시각만 돌려준다 (누구의 무슨 회의인지는 주지 않는다)
create function public.room_busy(p_room_id uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.starts_at, e.ends_at
  from public.events e
  where (select auth.uid()) is not null
    and e.room_id = p_room_id
    and e.canceled_at is null
    and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
  order by e.starts_at;
$$;

-- 함수는 기본으로 누구나(public) 부를 수 있다. 로그인 사용자만 부르게 한다.
-- 트리거 함수는 직접 부를 일이 없으므로 아무에게도 주지 않는다
revoke execute on function
  public.is_member(uuid), public.channel_type(uuid), public.is_admin(),
  public.is_event_participant(uuid), public.is_event_owner(uuid),
  public.create_dm(uuid), public.create_event(text, timestamptz, timestamptz, uuid, uuid[], text),
  public.room_busy(uuid, timestamptz, timestamptz),
  public.handle_new_user(), public.channels_add_creator(), public.messages_check_parent(),
  public.messages_touch_edited(), public.read_positions_forward(), public.events_touch_updated(),
  public.event_attendees_touch_response(), public.memberships_log_admin()
from public, anon;
grant execute on function
  public.is_member(uuid), public.channel_type(uuid), public.is_admin(),
  public.is_event_participant(uuid), public.is_event_owner(uuid),
  public.create_dm(uuid), public.create_event(text, timestamptz, timestamptz, uuid, uuid[], text),
  public.room_busy(uuid, timestamptz, timestamptz)
to authenticated;

-- ─── 첨부 버킷 ───────────────────────────────────────
-- 비공개. 크기·형식을 버킷에서도 막는다 (서버 검사와 두 번). storage.objects 정책은 두지 않는다 → 서명 URL 로만 오간다
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 5242880, array['image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do nothing;

-- ─── 실시간 구독 대상 ────────────────────────────────
-- 구독자마다 RLS 를 적용해서 보낸다 (볼 수 있는 행만 온다)
alter publication supabase_realtime add table
  public.messages, public.memberships, public.read_positions, public.notifications;
