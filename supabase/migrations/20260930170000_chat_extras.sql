-- 채팅 화면 개편에 따른 기능 (2026-09-30, 이호섭, WU-35)
-- 1) 즐겨찾기: 내가 고른 채널·DM 을 목록 맨 위에. 본인 것만 읽고 쓴다
-- 2) 채널 설명·이름 수정: 만든 사람·관리자만. 부서 채널(#일반 포함)의 이름은 조직 이름을 따라가므로 사람이 못 바꾼다
-- 3) 고정 메시지: 채널 멤버 누구나 고정·해제 (toggle_pin), 멤버만 본다
-- 4) 리액션: 채널 멤버가 정해진 이모지로 (toggle_reaction). 해제는 행을 지우지 않고 removed_at 을 채운다 —
--    실시간 DELETE 이벤트는 채널로 거를 수 없고 RLS 도 안 거쳐서, UPDATE 로만 바꿔 같은 채널 멤버에게만 가게 한다
-- 5) 채널별 알림 끄기: 끈 채널의 메시지 알림(멘션·답글·DM)은 만들지 않는다 (notifications BEFORE INSERT)
-- 채널에서 나가면 그 채널의 즐겨찾기·알림 끄기도 지운다.

-- ─── 1. 즐겨찾기 ────────────────────────────────────
create table public.channel_favorites (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);
alter table public.channel_favorites enable row level security;
revoke all on public.channel_favorites from anon, authenticated;
grant select, delete on public.channel_favorites to authenticated;
grant insert (channel_id) on public.channel_favorites to authenticated;
create policy "본인 즐겨찾기 조회" on public.channel_favorites
  for select to authenticated using (user_id = (select auth.uid()));
create policy "내 채널만 즐겨찾기" on public.channel_favorites
  for insert to authenticated with check (user_id = (select auth.uid()) and public.is_member(channel_id));
create policy "본인 즐겨찾기 삭제" on public.channel_favorites
  for delete to authenticated using (user_id = (select auth.uid()));

-- ─── 2. 채널 설명·이름 수정 ─────────────────────────
alter table public.channels
  add column description text not null default '',
  add constraint channels_description_len check (char_length(description) <= 120);

grant update (name, description) on public.channels to authenticated;
create policy "만든 사람·관리자가 채널 수정" on public.channels
  for update to authenticated
  using (type <> 'dm' and (created_by = (select auth.uid()) or public.is_admin()))
  with check (type <> 'dm' and (created_by = (select auth.uid()) or public.is_admin()));

-- 부서 채널의 이름은 org_units 트리거(security definer)만 바꾼다. 사용자 요청(authenticated)으로는 거부한다
create function public.channels_guard_org_name() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.name is distinct from old.name
     and current_user = 'authenticated'
     and exists (select 1 from public.org_units where channel_id = new.id) then
    raise exception '부서 채널의 이름은 조직 이름을 따라갑니다' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger channels_guard_org_name
  before update of name on public.channels
  for each row execute function public.channels_guard_org_name();

-- ─── 3. 고정 메시지 ─────────────────────────────────
create table public.pinned_messages (
  message_id bigint primary key references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  pinned_by  uuid references public.profiles (id) on delete set null,
  pinned_at  timestamptz not null default now()
);
create index pinned_messages_channel_idx on public.pinned_messages (channel_id, pinned_at desc);
alter table public.pinned_messages enable row level security;
revoke all on public.pinned_messages from anon, authenticated;
grant select on public.pinned_messages to authenticated;
create policy "멤버만 고정 메시지 조회" on public.pinned_messages
  for select to authenticated using (public.is_member(channel_id));

-- 고정돼 있으면 풀고, 아니면 고정한다. 돌려주는 값: 이제 고정돼 있으면 true
create function public.toggle_pin(p_message bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ch uuid;
begin
  select channel_id into ch from public.messages where id = p_message and deleted_at is null;
  if ch is null or not public.is_member(ch) then
    raise exception '고정할 수 없는 메시지입니다' using errcode = '42501';
  end if;
  delete from public.pinned_messages where message_id = p_message;
  if found then
    return false;
  end if;
  insert into public.pinned_messages (message_id, channel_id, pinned_by) values (p_message, ch, (select auth.uid()));
  return true;
end;
$$;
revoke execute on function public.toggle_pin(bigint) from public, anon;
grant execute on function public.toggle_pin(bigint) to authenticated;

-- ─── 4. 리액션 ──────────────────────────────────────
create table public.message_reactions (
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '👏', '🎉', '👌', '✅', '🙏')),
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (message_id, user_id, emoji)
);
create index message_reactions_channel_idx on public.message_reactions (channel_id, message_id);
alter table public.message_reactions enable row level security;
revoke all on public.message_reactions from anon, authenticated;
grant select on public.message_reactions to authenticated;
create policy "멤버만 리액션 조회" on public.message_reactions
  for select to authenticated using (public.is_member(channel_id));

-- 누르면 달고, 다시 누르면 뗀다. 돌려주는 값: 이제 달려 있으면 true
create function public.toggle_reaction(p_message bigint, p_emoji text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ch uuid;
  me uuid := (select auth.uid());
  now_on boolean;
begin
  select channel_id into ch from public.messages where id = p_message and deleted_at is null;
  if me is null or ch is null or not public.is_member(ch) then
    raise exception '리액션을 달 수 없는 메시지입니다' using errcode = '42501';
  end if;
  insert into public.message_reactions (message_id, user_id, emoji, channel_id)
  values (p_message, me, p_emoji, ch)
  on conflict (message_id, user_id, emoji) do update
    set removed_at = case when public.message_reactions.removed_at is null then now() else null end
  returning removed_at is null into now_on;
  return now_on;
end;
$$;
revoke execute on function public.toggle_reaction(bigint, text) from public, anon;
grant execute on function public.toggle_reaction(bigint, text) to authenticated;

-- ─── 5. 채널별 알림 끄기 ────────────────────────────
create table public.channel_mutes (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);
alter table public.channel_mutes enable row level security;
revoke all on public.channel_mutes from anon, authenticated;
grant select, delete on public.channel_mutes to authenticated;
grant insert (channel_id) on public.channel_mutes to authenticated;
create policy "본인 알림 설정 조회" on public.channel_mutes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "내 채널만 알림 끄기" on public.channel_mutes
  for insert to authenticated with check (user_id = (select auth.uid()) and public.is_member(channel_id));
create policy "본인 알림 다시 켜기" on public.channel_mutes
  for delete to authenticated using (user_id = (select auth.uid()));

create function public.notifications_skip_muted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.channel_mutes where user_id = new.user_id and channel_id = new.channel_id) then
    return null;
  end if;
  return new;
end;
$$;
create trigger notifications_skip_muted
  before insert on public.notifications
  for each row when (new.channel_id is not null)
  execute function public.notifications_skip_muted();
revoke execute on function public.notifications_skip_muted() from public, anon, authenticated;

-- ─── 채널에서 나가면 개인 설정도 지운다 ─────────────
create function public.memberships_clear_personal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.channel_favorites where user_id = old.user_id and channel_id = old.channel_id;
  delete from public.channel_mutes where user_id = old.user_id and channel_id = old.channel_id;
  return null;
end;
$$;
create trigger memberships_clear_personal
  after delete on public.memberships
  for each row execute function public.memberships_clear_personal();
revoke execute on function public.memberships_clear_personal() from public, anon, authenticated;

-- ─── 실시간 ─────────────────────────────────────────
-- 리액션만 실시간으로 받는다 (INSERT·UPDATE, 채널로 걸러서). 나머지는 화면이 다시 불러온다
alter publication supabase_realtime add table public.message_reactions;
