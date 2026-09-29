-- 가입 트리거보다 먼저 가입한 사람의 profiles 를 채운다 (2026-09-29).
-- DB v1 적용 전에 로그인 작업을 시험하며 가입한 계정이 1개 있었다. profiles 가 없으면 메시지를 쓸 수 없다 (작성자 FK).
-- 가입 트리거와 같은 규칙을 쓰도록 profiles 만드는 부분을 create_profile() 로 뺐다.

create function public.create_profile(p_id uuid, p_email text, p_meta jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  base text;
  candidate text;
  n integer := 0;
begin
  -- handle 은 가입 정보(handle) → 메일 앞부분 순으로 정하고, 겹치면 숫자를 붙인다
  base := coalesce(nullif(p_meta ->> 'handle', ''), split_part(coalesce(p_email, ''), '@', 1));
  base := left(regexp_replace(base, '[^A-Za-z0-9_가-힣-]', '', 'g'), 16);
  if base = '' then
    base := 'user';
  end if;
  candidate := base;
  while exists (select 1 from public.profiles where lower(handle) = lower(candidate)) loop
    n := n + 1;
    candidate := base || n::text;
  end loop;

  -- role 은 가입 정보로 정하지 않는다 (누구나 admin 으로 가입할 수 있게 되므로)
  insert into public.profiles (id, handle, display_name, department, title)
  values (
    p_id,
    candidate,
    coalesce(nullif(left(btrim(p_meta ->> 'display_name'), 40), ''), candidate),
    nullif(btrim(p_meta ->> 'department'), ''),
    nullif(btrim(p_meta ->> 'title'), '')
  )
  on conflict (id) do nothing;
end;
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.create_profile(new.id, new.email, coalesce(new.raw_user_meta_data, '{}'));
  return new;
end;
$$;

revoke execute on function public.create_profile(uuid, text, jsonb) from public, anon, authenticated;

select public.create_profile(u.id, u.email, coalesce(u.raw_user_meta_data, '{}'))
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);
