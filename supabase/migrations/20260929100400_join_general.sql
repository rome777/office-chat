-- 모든 사람은 #일반 에 들어간다 (2026-09-29). #일반 은 전사 공개 채널이다.
-- 로그인(WU-03)이 붙어 이제 로그인한 사람이 #일반 에서 대화하는데, 멤버가 아니면 RLS 가 아무것도 보여 주지 않는다.
-- 가입 시(profiles 가 생길 때) 넣고, 이미 가입한 사람도 넣는다. 관리 기록에는 남지 않는다 (auth.uid() 가 없는 작업)

create function public.join_general() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.memberships (channel_id, user_id)
  select c.id, new.id from public.channels c where c.id = '00000000-0000-0000-0000-000000000001'
  on conflict do nothing;
  return new;
end;
$$;
create trigger profiles_join_general
  after insert on public.profiles
  for each row execute function public.join_general();
revoke execute on function public.join_general() from public, anon, authenticated;

insert into public.memberships (channel_id, user_id)
select '00000000-0000-0000-0000-000000000001', p.id
from public.profiles p
where exists (select 1 from public.channels where id = '00000000-0000-0000-0000-000000000001')
on conflict do nothing;
