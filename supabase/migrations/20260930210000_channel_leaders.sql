-- 채널 리더·부리더 (2026-09-30 사용자 결정, WU-39)
-- 일반 채널(부서 채널이 아닌 공개·비공개 채널)에 리더 1명과 부리더 여러 명을 둔다. 리더는 처음에 만든 사람이다.
--   이름·설명 수정: 리더           초대: 공개는 멤버 누구나, 비공개는 리더·부리더
--   내보내기: 리더는 부리더·멤버, 부리더는 일반 멤버만        부리더 지정·해제, 리더 넘기기: 리더
--   부리더 한도: 멤버 10명당 1명, 최대 5명 (넘기기로 원래 리더가 부리더가 될 때만 한도를 넘을 수 있다)
--   리더가 나가거나 내보내지면: 먼저 부리더가 된 사람 → 없으면 가장 먼저 들어온 멤버가 리더. 비어 있던 채널에 들어온 첫 사람도 리더
-- 역할을 바꾸는 곳(함수·트리거)은 채널 행을 잠가 차례로 처리한다 (동시에 나가기·넘기기·지정해도 리더가 비거나 한도를 넘지 않게)
-- 회사 관리자(profiles.role = 'admin')는 모든 채널에서 다 한다. 부서 채널(#일반 포함)·DM 은 그대로다.
-- 전의 초대 권한(can_invite)은 더 쓰지 않는다: 칸은 남기되 화면·API 로 고치지 못하게 막는다.

-- ─── 1. 멤버 역할 ───────────────────────────────────
alter table public.memberships
  add column role text not null default 'member' check (role in ('leader', 'sub', 'member')),
  add column role_at timestamptz; -- 리더·부리더가 된 시각 (다음 리더를 고를 때 먼저 된 부리더부터)

create unique index memberships_one_leader on public.memberships (channel_id) where role = 'leader';

-- 이미 있는 일반 채널: 만든 사람이 멤버면 리더, 아니면 가장 먼저 들어온 멤버가 리더
with pick as (
  select distinct on (m.channel_id) m.channel_id, m.user_id
  from public.memberships m
  join public.channels c on c.id = m.channel_id
  where c.type in ('public', 'private')
    and not exists (select 1 from public.org_units o where o.channel_id = c.id)
  order by m.channel_id, (m.user_id = c.created_by) desc, m.joined_at, m.user_id
)
update public.memberships m
set role = 'leader', role_at = now()
from pick
where m.channel_id = pick.channel_id and m.user_id = pick.user_id;

-- 채널을 만든 사람은 멤버가 되고 리더가 된다 (부서 채널은 만든 사람이 없어 해당 없음)
create or replace function public.channels_add_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is not null then
    insert into public.memberships (channel_id, user_id, can_invite, role, role_at)
    values (
      new.id, new.created_by, false,
      case when new.type in ('public', 'private') then 'leader' else 'member' end,
      case when new.type in ('public', 'private') then now() end
    )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- ─── 2. 판단 함수 ───────────────────────────────────
-- 이 채널에서 내 역할 (멤버가 아니면 null)
create function public.my_channel_role(p_channel uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.memberships where channel_id = p_channel and user_id = (select auth.uid());
$$;
revoke execute on function public.my_channel_role(uuid) from public, anon;
grant execute on function public.my_channel_role(uuid) to authenticated;

-- 리더·부리더를 두는 채널인가: 부서 채널이 아닌 공개·비공개 채널
create function public.is_team_channel(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.channel_type(p_channel) in ('public', 'private'), false)
     and not public.is_org_channel(p_channel);
$$;
revoke execute on function public.is_team_channel(uuid) from public, anon;
grant execute on function public.is_team_channel(uuid) to authenticated;

-- 부리더 한도: 멤버 10명당 1명, 최대 5명
create function public.sub_leader_limit(p_channel uuid) returns int
language sql stable security definer set search_path = '' as $$
  select least(5, greatest(1, ceil(count(*) / 10.0)::int)) from public.memberships where channel_id = p_channel;
$$;
revoke execute on function public.sub_leader_limit(uuid) from public, anon, authenticated;

-- 남을 넣을 수 있는가: 관리자, 또는 일반 채널에서 공개면 멤버·비공개면 리더·부리더. 부서 채널·DM 은 관리자만(DM 은 아무도)
create or replace function public.has_invite_right(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.channel_type(p_channel) in ('public', 'private')
    and (
      public.is_admin()
      or (
        public.is_team_channel(p_channel)
        and case public.channel_type(p_channel)
              when 'public' then public.my_channel_role(p_channel) is not null
              else public.my_channel_role(p_channel) in ('leader', 'sub')
            end
      )
    ),
    false);
$$;

-- ─── 3. 정책 ────────────────────────────────────────
-- 이름·설명 수정: 관리자 또는 일반 채널의 리더
drop policy "만든 사람·관리자가 채널 수정" on public.channels;
create policy "리더·관리자가 채널 수정" on public.channels
  for update to authenticated
  using (type <> 'dm' and (public.is_admin() or (public.is_team_channel(id) and public.my_channel_role(id) = 'leader')))
  with check (type <> 'dm' and (public.is_admin() or (public.is_team_channel(id) and public.my_channel_role(id) = 'leader')));

-- 나가기·내보내기: 본인 나가기(부서 채널 제외), 관리자는 누구나, 리더는 부리더·멤버, 부리더는 멤버를 내보낸다.
-- 정책의 role 은 내보내지는 사람(그 행)의 역할이다
drop policy "본인 나가기(부서 채널 제외), 관리자는 제거" on public.memberships;
create policy "본인 나가기, 리더·부리더·관리자는 내보내기" on public.memberships
  for delete to authenticated using (
    public.channel_type(channel_id) <> 'dm'
    and (
      (user_id = (select auth.uid()) and not public.is_org_channel(channel_id))
      or public.is_admin()
      or (
        public.is_team_channel(channel_id)
        and user_id <> (select auth.uid())
        and (
          (public.my_channel_role(channel_id) = 'leader' and role in ('sub', 'member'))
          or (public.my_channel_role(channel_id) = 'sub' and role = 'member')
        )
      )
    )
  );

-- 전의 초대 권한 주기(can_invite 고치기)는 막는다. 역할은 아래 함수로만 바꾼다
drop policy "초대 권한 주기, 관리자는 빼기" on public.memberships;
revoke update (can_invite) on public.memberships from authenticated;

-- ─── 4. 역할 바꾸기 (화면은 이 함수만 부른다) ─────────
-- 역할이 바뀌면 관리 기록에 남긴다. actor 가 없으면(리더가 나가서 자동으로 넘어간 경우) actor 없이 남긴다
create function public.log_channel_role(p_action text, p_channel uuid, p_user uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.admin_logs (actor_id, action, target)
  values ((select auth.uid()), p_action, jsonb_build_object('channel_id', p_channel, 'user_id', p_user));
$$;
revoke execute on function public.log_channel_role(text, uuid, uuid) from public, anon, authenticated;

-- 부리더로 지정하거나 해제한다: 리더(또는 관리자)만, 일반 채널에서, 리더가 아닌 멤버에게
create function public.set_sub_leader(p_channel uuid, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target_role text;
begin
  if not public.is_team_channel(p_channel) then
    raise exception '리더·부리더가 없는 채널입니다' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.my_channel_role(p_channel) = 'leader') then
    raise exception '리더만 부리더를 정합니다' using errcode = '42501';
  end if;
  perform 1 from public.channels where id = p_channel for update; -- 동시에 두 명을 지정해 한도를 넘지 않게
  select role into target_role from public.memberships where channel_id = p_channel and user_id = p_user for update;
  if target_role is null then
    raise exception '이 채널 멤버가 아닙니다' using errcode = 'P0002';
  end if;
  if target_role = 'leader' then
    raise exception '리더는 부리더가 될 수 없습니다' using errcode = '22023';
  end if;
  if p_on and target_role = 'member' then
    if (select count(*) from public.memberships where channel_id = p_channel and role = 'sub') >= public.sub_leader_limit(p_channel) then
      raise exception '부리더는 멤버 10명당 1명, 최대 5명까지입니다' using errcode = '23514';
    end if;
    update public.memberships set role = 'sub', role_at = now() where channel_id = p_channel and user_id = p_user;
    perform public.log_channel_role('grant_sub', p_channel, p_user);
  elsif not p_on and target_role = 'sub' then
    update public.memberships set role = 'member', role_at = null where channel_id = p_channel and user_id = p_user;
    perform public.log_channel_role('revoke_sub', p_channel, p_user);
  end if;
end;
$$;
revoke execute on function public.set_sub_leader(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_sub_leader(uuid, uuid, boolean) to authenticated;

-- 리더를 넘긴다: 리더(또는 관리자)가 다른 멤버에게. 원래 리더는 부리더가 된다 (이때만 부리더 한도를 넘을 수 있다)
create function public.transfer_leader(p_channel uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  old_leader uuid;
begin
  if not public.is_team_channel(p_channel) then
    raise exception '리더·부리더가 없는 채널입니다' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.my_channel_role(p_channel) = 'leader') then
    raise exception '리더만 리더를 넘깁니다' using errcode = '42501';
  end if;
  perform 1 from public.channels where id = p_channel for update;
  -- 받는 사람 행을 잠근다 (확인과 바꾸기 사이에 나가 버리면 리더가 비므로)
  perform 1 from public.memberships where channel_id = p_channel and user_id = p_user for update;
  if not found then
    raise exception '이 채널 멤버가 아닙니다' using errcode = 'P0002';
  end if;
  select user_id into old_leader from public.memberships where channel_id = p_channel and role = 'leader' for update;
  if old_leader = p_user then
    return;
  end if;
  if old_leader is not null then
    update public.memberships set role = 'sub', role_at = now() where channel_id = p_channel and user_id = old_leader;
  end if;
  update public.memberships set role = 'leader', role_at = now() where channel_id = p_channel and user_id = p_user;
  if not found then
    raise exception '리더를 넘기지 못했습니다' using errcode = 'P0002';
  end if;
  perform public.log_channel_role('transfer_leader', p_channel, p_user);
end;
$$;
revoke execute on function public.transfer_leader(uuid, uuid) from public, anon;
grant execute on function public.transfer_leader(uuid, uuid) to authenticated;

-- ─── 5. 리더가 빠지면 다음 리더 ──────────────────────
-- 먼저 부리더가 된 사람 → 없으면 가장 먼저 들어온 멤버. 채널을 통째로 지울 때는 채널이 먼저 사라져 건너뛴다.
-- 후보가 동시에 나가는 중이면(행이 잠김) 건너뛰고 다음 사람을 고른다. 실제로 올렸을 때만 기록한다
create function public.memberships_next_leader() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  next_user uuid;
begin
  if old.role <> 'leader' or not public.is_team_channel(old.channel_id) then
    return null;
  end if;
  perform 1 from public.channels where id = old.channel_id for update;
  if exists (select 1 from public.memberships where channel_id = old.channel_id and role = 'leader') then
    return null;
  end if;
  loop
    select user_id into next_user
    from public.memberships
    where channel_id = old.channel_id
    order by (role = 'sub') desc, case when role = 'sub' then role_at end nulls last, joined_at, user_id
    limit 1
    for update skip locked;
    exit when next_user is null;
    update public.memberships set role = 'leader', role_at = now() where channel_id = old.channel_id and user_id = next_user;
    if found then
      insert into public.admin_logs (actor_id, action, target)
      values (null, 'auto_leader', jsonb_build_object('channel_id', old.channel_id, 'user_id', next_user, 'from', old.user_id));
      exit;
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function public.memberships_next_leader() from public, anon, authenticated;
create trigger memberships_next_leader
  after delete on public.memberships
  for each row execute function public.memberships_next_leader();

-- 리더가 없는 일반 채널(모두 나가 비었던 채널)에 들어온 사람은 리더가 된다
create function public.memberships_first_leader() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'leader' or not public.is_team_channel(new.channel_id) then
    return null;
  end if;
  perform 1 from public.channels where id = new.channel_id for update;
  if exists (select 1 from public.memberships where channel_id = new.channel_id and role = 'leader') then
    return null;
  end if;
  update public.memberships set role = 'leader', role_at = now() where channel_id = new.channel_id and user_id = new.user_id;
  if found then
    insert into public.admin_logs (actor_id, action, target)
    values (null, 'auto_leader', jsonb_build_object('channel_id', new.channel_id, 'user_id', new.user_id));
  end if;
  return null;
end;
$$;
revoke execute on function public.memberships_first_leader() from public, anon, authenticated;
create trigger memberships_first_leader
  after insert on public.memberships
  for each row execute function public.memberships_first_leader();
