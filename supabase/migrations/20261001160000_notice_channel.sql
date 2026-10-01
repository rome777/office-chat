-- 공지 채널 (2026-10-01, 이호섭 ①, WU-45 — 사용자 요청 "사내 공지를 담당하는 부서의 담당자가 전체에 공지할 수 있는 공지 채널").
-- 다음 작업으로 대시보드에 회사 공지 위젯을 붙인다 — 위젯은 notice_unit_id 가 있는 채널의 최상위 메시지를 읽으면 된다.
--
--   channels.notice_unit_id  공지 담당 부서. 이 칸이 있는 채널이 공지 채널이다 (공개·비공개 채널만, DM·부서 채널은 안 된다)
--   새 글(최상위 메시지): 담당 부서(하위 부서 포함) 사람 · 그 채널 리더·부리더 · 회사 관리자만.
--   답글(공지에 대한 질문)·리액션·고정: 멤버 누구나 (지금 규칙 그대로)
--   검사는 메시지를 쓴 사람(user_id) 기준이다 — 첨부 메시지처럼 서버(service role)가 대신 넣는 행에도, 시드에도 같은 규칙이 걸린다.
--   멤버: 공지 채널이 되면 모든 사람을 넣고, 새로 가입한 사람도 넣는다 (#일반 과 같게). 본인이 나가지는 못한다.
--   담당 부서는 화면에서 바꾸지 않는다 — notice_unit_id 의 수정 권한을 주지 않는다 (SQL·시드로만 정한다)

alter table public.channels
  add column notice_unit_id uuid references public.org_units (id) on delete set null,
  add constraint channels_notice_type check (notice_unit_id is null or type in ('public', 'private'));

-- 이 사람이 이 채널에 새 글을 쓸 수 있나 (공지 채널이 아니면 언제나 true — 멤버인지는 RLS 가 따로 본다)
create function public.notice_poster(p_channel uuid, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  unit uuid;
begin
  select notice_unit_id into unit from public.channels where id = p_channel;
  if unit is null then
    return true;
  end if;
  return exists (select 1 from public.profiles where id = p_user and role = 'admin')
    or exists (select 1 from public.memberships
               where channel_id = p_channel and user_id = p_user and role in ('leader', 'sub'))
    or exists (
      with recursive tree (id) as (
        select unit
        union
        select u.id from public.org_units u join tree t on u.parent_id = t.id
      )
      select 1 from public.profiles p join tree t on t.id = p.org_unit_id where p.id = p_user
    );
end;
$$;

-- 화면용: 내가 이 채널에 새 글을 쓸 수 있나 (입력창 대신 안내를 띄울지 정한다)
create function public.can_post_in(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.notice_poster(p_channel, (select auth.uid()));
$$;

-- 새 글 검사. 답글(parent_id 있음)은 누구나. 익명(Step 1 호환, user_id 없음)은 #일반 에만 쓰므로 공지 채널과 상관없다
create function public.messages_check_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_id is null and new.user_id is not null and not public.notice_poster(new.channel_id, new.user_id) then
    raise exception '공지 채널에는 공지 담당 부서만 새 글을 올릴 수 있습니다. 공지에 답글로 질문해 주세요'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger messages_check_notice
  before insert on public.messages
  for each row execute function public.messages_check_notice();

-- 공지 채널이 되면 모든 사람을 넣는다
create function public.channels_notice_join_all() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.memberships (channel_id, user_id)
  select new.id, p.id from public.profiles p
  on conflict do nothing;
  return null;
end;
$$;
create trigger channels_notice_join_all
  after insert or update of notice_unit_id on public.channels
  for each row when (new.notice_unit_id is not null)
  execute function public.channels_notice_join_all();

-- 새로 가입한 사람도 공지 채널에 넣는다
create function public.join_notice_channels() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.memberships (channel_id, user_id)
  select c.id, new.id from public.channels c where c.notice_unit_id is not null
  on conflict do nothing;
  return new;
end;
$$;
create trigger profiles_join_notice
  after insert on public.profiles
  for each row execute function public.join_notice_channels();

-- 본인이 공지 채널에서 나가지 못한다 (관리자·리더가 내보내는 것, 계정을 지울 때 함께 지워지는 것은 그대로)
create function public.memberships_keep_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.user_id = (select auth.uid())
     and exists (select 1 from public.channels where id = old.channel_id and notice_unit_id is not null) then
    raise exception '공지 채널은 나갈 수 없습니다' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger memberships_keep_notice
  before delete on public.memberships
  for each row execute function public.memberships_keep_notice();

revoke execute on function
  public.notice_poster(uuid, uuid),
  public.messages_check_notice(),
  public.channels_notice_join_all(),
  public.join_notice_channels(),
  public.memberships_keep_notice()
from public, anon, authenticated;
revoke execute on function public.can_post_in(uuid) from public, anon;
grant execute on function public.can_post_in(uuid) to authenticated;
