-- 초대 권한 (2026-09-29)
-- 전에는 비공개 채널에 사람을 넣는 것이 관리자만 됐다. 이제는 채널을 만든 사람과, 초대 권한을 받은 멤버도 넣는다.
-- 초대 권한이 있는 멤버는 같은 채널의 다른 멤버에게 초대 권한을 줄 수 있다. 권한을 빼는 것은 관리자만.
-- 멤버를 내보내는 것은 그대로 관리자만이다. DM 에는 해당하지 않는다.

alter table public.memberships add column can_invite boolean not null default false;

-- 이미 있는 채널은 만든 사람에게 권한을 준다 (auth.uid() 가 없으므로 관리 기록에는 남지 않는다)
update public.memberships m
set can_invite = true
from public.channels c
where c.id = m.channel_id and c.created_by = m.user_id and c.type in ('public', 'private');

-- 채널을 만든 사람은 그 채널 멤버가 되고 초대 권한을 갖는다
create or replace function public.channels_add_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is not null then
    insert into public.memberships (channel_id, user_id, can_invite)
    values (new.id, new.created_by, new.type in ('public', 'private'))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- 이 채널에 사람을 넣을 수 있는가: 관리자이거나 초대 권한이 있는 멤버. DM 은 아무도 못 한다
create function public.has_invite_right(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.channel_type(p_channel) in ('public', 'private')
     and (
       public.is_admin()
       or exists (
         select 1 from public.memberships
         where channel_id = p_channel and user_id = (select auth.uid()) and can_invite
       )
     );
$$;
revoke execute on function public.has_invite_right(uuid) from public, anon;
grant execute on function public.has_invite_right(uuid) to authenticated;

-- 넣기: 공개 채널은 본인 가입, 권한 있는 사람은 남을 넣는다. can_invite 는 insert 컬럼 권한이 없어 늘 false 로 들어간다
drop policy "공개 채널 가입, 관리자는 추가" on public.memberships;
create policy "공개 채널 가입, 권한 있는 사람은 추가" on public.memberships
  for insert to authenticated with check (
    (user_id = (select auth.uid()) and public.channel_type(channel_id) = 'public')
    or public.has_invite_right(channel_id)
  );

-- 초대 권한 주기: 권한 있는 사람만 고친다. 관리자가 아니면 true 로만 바꿀 수 있다 (빼기는 관리자만)
grant update (can_invite) on public.memberships to authenticated;
create policy "초대 권한 주기, 관리자는 빼기" on public.memberships
  for update to authenticated
  using (public.has_invite_right(channel_id))
  with check (public.has_invite_right(channel_id) and (can_invite or public.is_admin()));

-- 초대 권한을 주고 빼면 관리 기록에 남긴다 (서버·마이그레이션 작업은 빼고)
create function public.memberships_log_invite_right() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null or new.can_invite is not distinct from old.can_invite then
    return null;
  end if;
  insert into public.admin_logs (actor_id, action, target)
  values (
    actor,
    case when new.can_invite then 'grant_invite' else 'revoke_invite' end,
    jsonb_build_object('channel_id', new.channel_id, 'user_id', new.user_id)
  );
  return null;
end;
$$;
revoke execute on function public.memberships_log_invite_right() from public, anon;
create trigger memberships_log_invite_right
  after update of can_invite on public.memberships
  for each row execute function public.memberships_log_invite_right();
