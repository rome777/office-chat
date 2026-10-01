-- 반복 일정은 대화방 하나를 같이 쓴다 (2026-10-01, 김송이 ②, WU-44 화면 확인에서 발견).
-- 전에는 open_event_chat 이 회차(행)마다 chat_channel_id 를 봐서, 다른 회차에서 [참석자와 대화]를 누르면 같은 이름의 방이 또 생겼다.
-- 이제 묶음(series_id)에 이미 이어진 방이 있으면 그 방을 쓰고, 방을 만들거나 찾으면 묶음의 모든 회차에 잇는다.

create or replace function public.open_event_chat(p_event uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  ev public.events%rowtype;
  others uuid[];
  ch uuid;
begin
  if me is null or not exists (select 1 from public.event_attendees where event_id = p_event and user_id = me) then
    raise exception '참석자만 대화를 열 수 있습니다' using errcode = '42501';
  end if;
  select * into ev from public.events where id = p_event;
  select array_agg(user_id) into others from public.event_attendees where event_id = p_event and user_id <> me;
  if others is null then
    raise exception '대화할 참석자가 없습니다' using errcode = '22023';
  end if;
  if cardinality(others) = 1 then
    return public.create_dm(others[1]);
  end if;

  ch := ev.chat_channel_id;
  if (ch is null or not exists (select 1 from public.channels where id = ch)) and ev.series_id is not null then
    select e.chat_channel_id into ch
    from public.events e
    join public.channels c on c.id = e.chat_channel_id
    where e.series_id = ev.series_id
    order by e.starts_at
    limit 1;
  end if;
  if ch is null or not exists (select 1 from public.channels where id = ch) then
    insert into public.channels (name, type, created_by)
    values (left(ev.title, 40), 'private', me)
    returning id into ch;
  end if;
  if ev.series_id is not null then
    update public.events set chat_channel_id = ch
    where series_id = ev.series_id and chat_channel_id is distinct from ch;
  else
    update public.events set chat_channel_id = ch where id = p_event and chat_channel_id is distinct from ch;
  end if;
  insert into public.memberships (channel_id, user_id)
  select ch, a.user_id from public.event_attendees a where a.event_id = p_event
  on conflict do nothing;
  return ch;
end;
$$;
