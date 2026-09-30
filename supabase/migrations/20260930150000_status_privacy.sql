-- 상태를 남에게 숨긴다 (2026-09-30, ② 김송이, WU-34)
-- profiles 는 로그인한 누구나 모든 칸을 읽었다. 그러면 "오프라인으로 표시"(status = 'invisible') 중인 사람이 사실 접속해 있다는 것이 API 로 드러난다.
-- → status 칸의 읽기 권한만 거두고, 본인 상태는 my_status() 로 읽는다.
-- 남의 상태는 DB 가 아니라 접속자 채널(presence)로 받는다: 접속 중인 사람만 자기 상태를 실어 보내고, invisible 이면 아예 들어가지 않는다 (TECH_SPEC 4절 "내 프로필").

revoke select on public.profiles from authenticated;
grant select (id, handle, display_name, department, title, role, created_at, org_unit_id, avatar, status_message)
  on public.profiles to authenticated;

create function public.my_status() returns text
language sql stable security definer set search_path = '' as $$
  select status from public.profiles where id = (select auth.uid());
$$;

revoke all on function public.my_status() from public, anon;
grant execute on function public.my_status() to authenticated;
