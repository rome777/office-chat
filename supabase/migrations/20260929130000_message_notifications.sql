-- 메시지 알림 만들기 (알림 작업, 2026-09-29, TECH_SPEC 7절 "알림").
-- messages INSERT 트리거가 받는 사람을 정해 notifications 를 넣는다. 순서대로 넣고, (user_id, message_id) 유일 제약으로
-- 한 메시지로 한 사람에게 하나만 남는다 — DM 안에서 @B 를 부르면 B 에게는 mention 하나만.
--   1. mention       본문의 @handle 가운데 그 채널 멤버
--   2. thread_reply  답글이면: 부모 메시지 작성자 + 그 스레드에 이미 답한 사람 (채널 멤버만)
--   3. dm            DM 채널이면 상대방
-- 모든 경우에 보낸 사람은 뺀다. 재전송은 client_id 로 메시지가 한 건이라 알림도 한 건이다.
-- 익명(Step 1 임시 호환) 메시지는 알림을 만들지 않는다.
-- 일정 알림(초대·변경·취소·10분 전)은 일정 알림 작업에서 따로 넣는다.

create function public.messages_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  channel_type text;
begin
  if new.user_id is null then
    return null;
  end if;

  -- 1. 멘션. handle 은 대소문자를 가리지 않는다. 앞이 글자인 @ (메일 주소)는 멘션이 아니다
  insert into public.notifications (user_id, type, channel_id, message_id)
  select p.id, 'mention', new.channel_id, new.id
  from public.profiles p
  join public.memberships m on m.user_id = p.id and m.channel_id = new.channel_id
  where p.id <> new.user_id
    and lower(p.handle) in (
      select lower(x[1])
      from regexp_matches(new.body, '(?:^|[^[:alnum:]_])@([A-Za-z0-9_가-힣-]+)', 'g') as x
    )
  on conflict (user_id, message_id) do nothing;

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

create trigger messages_notify
  after insert on public.messages
  for each row execute function public.messages_notify();
revoke execute on function public.messages_notify() from public, anon, authenticated;
