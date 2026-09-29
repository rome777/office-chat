-- 조직도와 부서 채널 (2026-09-29)
-- 회사 → 사업부 → 본부 → 팀 의 조직을 org_units 에 둔다. 조직마다 대화방(비공개 채널)이 하나씩 있고,
-- 사람은 profiles.org_unit_id 로 한 조직에 속한다. 소속이 정해지거나 바뀌면 그 조직과 모든 상위 조직의 채널에
-- 자동으로 들어간다 (팀원이면 팀·본부·사업부·회사 채널). 회사(맨 위) 채널은 #일반 이다.
--
-- 누가 어디 소속인지는 사용자가 못 바꾼다 (profiles.org_unit_id 는 update 컬럼 권한이 없다 → 서버·시드만).
-- 부서 채널은 본인이 나갈 수 없다. 관리자는 뺄 수 있다.
-- 소속을 바꾸면 새 소속에 없는 부서 채널에서는 빠진다 (관리자가 손님으로 넣어 둔 다른 부서 채널도 포함).

create table public.org_units (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null check (kind in ('company', 'division', 'hq', 'team')),  -- 회사·사업부·본부·팀
  parent_id  uuid references public.org_units (id) on delete restrict,
  leader_id  uuid references public.profiles (id) on delete set null,              -- 대표·사업부장·본부장·팀장
  channel_id uuid not null unique references public.channels (id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint org_units_name check (name ~ '\S' and char_length(name) <= 40),
  constraint org_units_root check ((kind = 'company') = (parent_id is null))
);
create index org_units_parent_idx on public.org_units (parent_id);

alter table public.profiles add column org_unit_id uuid references public.org_units (id) on delete set null;
create index profiles_org_unit_idx on public.profiles (org_unit_id);

-- 조직도는 로그인한 사람이면 모두 본다. 쓰기는 서버(service role)만
alter table public.org_units enable row level security;
revoke all on public.org_units from anon, authenticated;
grant select on public.org_units to authenticated;
create policy "로그인 사용자는 모두 조회" on public.org_units
  for select to authenticated using (true);

-- 조직을 만들 때 채널을 주지 않으면 같은 이름의 비공개 채널을 만든다 (만든 사람 없음 → 멤버는 소속으로만 들어간다)
create function public.org_units_make_channel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.channel_id is null then
    insert into public.channels (name, type, created_by)
    values (new.name, 'private', null)
    returning id into new.channel_id;
  end if;
  return new;
end;
$$;
create trigger org_units_make_channel
  before insert on public.org_units
  for each row execute function public.org_units_make_channel();

-- 조직 이름을 바꾸면 채널 이름도 바꾼다 (회사 = #일반 은 그대로 둔다)
create function public.org_units_rename_channel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name and new.kind <> 'company' then
    update public.channels set name = new.name where id = new.channel_id;
  end if;
  return null;
end;
$$;
create trigger org_units_rename_channel
  after update of name on public.org_units
  for each row execute function public.org_units_rename_channel();

-- 이 채널이 부서 채널인가 (나가기 정책이 쓴다)
create function public.is_org_channel(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_units where channel_id = p_channel);
$$;

-- 사람의 부서 채널 멤버십을 소속에 맞춘다: 소속 조직과 모든 상위 조직의 채널에 넣고, 나머지 부서 채널에서는 뺀다
create function public.sync_org_memberships(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  wanted uuid[];
begin
  with recursive chain as (
    select u.id, u.parent_id, u.channel_id
    from public.org_units u
    join public.profiles p on p.org_unit_id = u.id
    where p.id = p_user
    union all
    select u.id, u.parent_id, u.channel_id
    from public.org_units u
    join chain c on u.id = c.parent_id
  )
  select coalesce(array_agg(channel_id), '{}') into wanted from chain;

  delete from public.memberships m
  using public.org_units u
  where m.user_id = p_user
    and m.channel_id = u.channel_id
    and u.kind <> 'company'          -- #일반 은 소속이 없어도 모두 들어간다 (join_general)
    and not (m.channel_id = any (wanted));

  insert into public.memberships (channel_id, user_id)
  select unnest(wanted), p_user
  on conflict do nothing;
end;
$$;

create function public.profiles_sync_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.org_unit_id is distinct from old.org_unit_id then
    perform public.sync_org_memberships(new.id);
  end if;
  return null;
end;
$$;
create trigger profiles_sync_org
  after insert or update of org_unit_id on public.profiles
  for each row execute function public.profiles_sync_org();

-- 조직을 다른 상위 조직 밑으로 옮기면 그 아래 사람들을 모두 다시 맞춘다
create function public.org_units_resync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  person uuid;
begin
  if new.parent_id is not distinct from old.parent_id then
    return null;
  end if;
  for person in
    with recursive sub as (
      select id from public.org_units where id = new.id
      union all
      select u.id from public.org_units u join sub s on u.parent_id = s.id
    )
    select p.id from public.profiles p where p.org_unit_id in (select id from sub)
  loop
    perform public.sync_org_memberships(person);
  end loop;
  return null;
end;
$$;
create trigger org_units_resync
  after update of parent_id on public.org_units
  for each row execute function public.org_units_resync();

revoke execute on function
  public.org_units_make_channel(), public.org_units_rename_channel(), public.sync_org_memberships(uuid),
  public.profiles_sync_org(), public.org_units_resync()
from public, anon, authenticated;
revoke execute on function public.is_org_channel(uuid) from public, anon;
grant execute on function public.is_org_channel(uuid) to authenticated;

-- 나가기: 부서 채널(#일반 포함)은 본인이 나갈 수 없다. 관리자는 DM 이 아니면 뺄 수 있다
drop policy "본인 나가기, 관리자는 제거" on public.memberships;
create policy "본인 나가기(부서 채널 제외), 관리자는 제거" on public.memberships
  for delete to authenticated using (
    public.channel_type(channel_id) <> 'dm'
    and (
      (user_id = (select auth.uid()) and not public.is_org_channel(channel_id))
      or public.is_admin()
    )
  );
