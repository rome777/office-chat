-- 프로필 카드에 회사 메일을 보인다 (2026-09-30, ② 김송이, 사용자 요청)
-- 로그인 메일은 auth.users 에만 있어 로그인한 사람도 남의 것을 읽을 수 없었다 (카드는 "본인 메일만" 보였다).
-- 사내 메신저의 회사 메일은 서로 보여도 되는 정보라, 로그인한 사람이 profiles 에 있는 사람의 메일 하나를 읽는 함수만 연다.
-- 목록 전체를 한 번에 주지 않는다 (카드를 열 때 그 사람 것만).

create function public.profile_email(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select u.email::text
  from auth.users u
  where u.id = p_user
    and exists (select 1 from public.profiles p where p.id = u.id);
$$;

revoke all on function public.profile_email(uuid) from public, anon;
grant execute on function public.profile_email(uuid) to authenticated;
