-- 모두·부서 멘션 (2026-09-30, 김송이 — 테스트 메모 반영. 알림 틀은 ③ 20260929130000_message_notifications.sql 과 같다)
-- 본문에는 사람이 보는 이름 대신 바뀌지 않는 글자를 저장한다 (화면은 lib/mentions.ts 가 이름으로 바꿔 보인다).
--   @all-members-in-channel   이 채널 멤버 전체 (화면: @모두). 22자 — handle 은 20자까지라 사람과 겹치지 않는다
--   @org-<org_units.id>       그 부서와 모든 하위 부서 소속 가운데 이 채널 멤버 (화면: @부서명). 40자
-- 알림 종류는 사람 멘션과 같은 mention 이다. (user_id, message_id) 유일 제약으로 한 사람에게 하나만 — 사람·모두·부서로 여러 번 불려도.
-- 누구나 쓸 수 있다 (2026-09-30 사용자 결정). 채널 밖 사람은 메시지를 못 읽으므로 알림도 없다.
-- 나머지(사람 멘션·스레드 답글·DM)는 20260929130000 과 같다. 함수만 바꾸고 트리거는 그대로 쓴다.

create or replace function public.messages_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  channel_type text;
  tokens text[];
begin
  if new.user_id is null then
    return null;
  end if;

  -- 본문의 멘션 글자들 (소문자). 앞이 글자인 @ (메일 주소)는 멘션이 아니다
  select coalesce(array_agg(distinct lower(x[1])), '{}') into tokens
  from regexp_matches(new.body, '(?:^|[^[:alnum:]_])@([A-Za-z0-9_가-힣-]+)', 'g') as x;

  if array_length(tokens, 1) > 0 then
    -- 1. 멘션. 사람(handle 이 맞는 사람) + 모두(채널 멤버 전체) + 부서(그 부서·하위 부서 소속). 모두 이 채널 멤버만
    insert into public.notifications (user_id, type, channel_id, message_id)
    select m.user_id, 'mention', new.channel_id, new.id
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.channel_id = new.channel_id
      and m.user_id <> new.user_id
      and (
        lower(p.handle) = any (tokens)
        or 'all-members-in-channel' = any (tokens)
        or p.org_unit_id in (
          with recursive picked as (
            select u.id from public.org_units u where 'org-' || u.id::text = any (tokens)
            union
            select c.id from public.org_units c join picked on c.parent_id = picked.id
          )
          select id from picked
        )
      )
    on conflict (user_id, message_id) do nothing;
  end if;

  -- 2. 스레드 답글
  if new.parent_id is not null then
    insert into public.notifications (user_id, type, channel_id, message_id)
    select distinct t.user_id, 'thread_reply', new.channel_id, new.id
    from (
      select user_id from public.messages where id = new.parent_id
      union
      select user_id from public.messages where parent_id = new.parent_id
    ) t
    join public.memberships m on m.user_id = t.user_id and m.channel_id = new.channel_id
    where t.user_id is not null and t.user_id <> new.user_id
    on conflict (user_id, message_id) do nothing;
  end if;

  -- 3. DM
  select type into channel_type from public.channels where id = new.channel_id;
  if channel_type = 'dm' then
    insert into public.notifications (user_id, type, channel_id, message_id)
    select m.user_id, 'dm', new.channel_id, new.id
    from public.memberships m
    where m.channel_id = new.channel_id and m.user_id <> new.user_id
    on conflict (user_id, message_id) do nothing;
  end if;

  return null;
end;
$$;
revoke execute on function public.messages_notify() from public, anon, authenticated;
