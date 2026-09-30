-- 일정 개편 2차 (2026-10-01, 김송이 ②, WU-43·44 — TECH_SPEC 4절 "일정 개편"):
--   반복 일정 (4단계)
--     events.series_id · recurrence(daily·weekly·weekdays·monthly). 회차를 행으로 미리 만든다 (최대 1년·52회)
--       → 회의실 겹침 제약·시작 전 알림·참석 응답이 한 행 기준 그대로 동작한다
--     create_event_series()   회차를 모두 만든다. 회의실이 겹치는 날이 하나라도 있으면 전체를 거부하고 그 날짜를 알려 준다
--     update_event_series()   "이후 모두" 고치기 (그 회차와 뒤 회차, 날짜는 그대로 두고 시각·내용·참석자를 바꾼다)
--     cancel_event_series()   "이후 모두" 취소
--     묶음으로 처리할 때는 회차마다 알림을 만들지 않고, 사람마다 한 번만 보낸다 (app.bulk_event 설정)
--   참석자와 대화 (5단계)
--     events.chat_channel_id · open_event_chat(): 상대가 한 명이면 DM, 여럿이면 참석자로 비공개 채널을 만들어 일정에 잇는다.
--     분류용 channel_id(일정을 만든 채널)와 따로 둔다 — 대화방을 만들었다고 프로젝트 일정이 되지 않게

alter table public.events
  add column series_id uuid,
  add column recurrence text
    constraint events_recurrence check (recurrence in ('daily', 'weekly', 'weekdays', 'monthly')),
  add column chat_channel_id uuid references public.channels (id) on delete set null,
  add constraint events_series check ((series_id is null) = (recurrence is null));
create index events_series_idx on public.events (series_id, starts_at) where series_id is not null;

-- 묶음 처리 중인가 (이 트랜잭션 안에서만)
create function public.event_bulk() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.bulk_event', true), '') = '1';
$$;

-- 초대 알림: 묶음 처리 중에는 만들지 않는다 (묶음 함수가 사람마다 한 번 넣는다)
create or replace function public.event_attendees_notify_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.event_bulk() then
    return null;
  end if;
  if exists (select 1 from public.events e where e.id = new.event_id and e.created_by = new.user_id) then
    return null; -- 만든 사람 자신
  end if;
  insert into public.notifications (user_id, type, event_id)
  values (new.user_id, 'event_invite', new.event_id)
  on conflict (user_id, event_id) where type = 'event_invite' do nothing;
  return null;
end;
$$;

-- 변경·취소 알림: 시작 시각이 바뀌면 시작 전 알림은 늘 지우고, 묶음 처리 중이면 알림은 만들지 않는다
create or replace function public.events_notify_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  kind text;
begin
  if new.starts_at is distinct from old.starts_at then
    delete from public.notifications where event_id = new.id and type = 'event_reminder';
  end if;
  if public.event_bulk() then
    return null;
  end if;

  if old.canceled_at is null and new.canceled_at is not null then
    kind := 'event_cancel';
  elsif new.canceled_at is null and (
    new.title is distinct from old.title
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.room_id is distinct from old.room_id
    or new.all_day is distinct from old.all_day
    or new.location is distinct from old.location
  ) then
    kind := 'event_update';
  else
    return null; -- 설명·분류·대화방만 바뀌었거나 취소된 일정을 고친 경우
  end if;

  insert into public.notifications (user_id, type, event_id)
  select a.user_id, kind, new.id
  from public.event_attendees a
  where a.event_id = new.id
    and a.response <> 'declined'
    and a.user_id is distinct from actor;
  return null;
end;
$$;

-- ─── 반복 일정 만들기 ────────────────────────────────
-- 첫 회차 id 를 돌려준다. 회차는 한국 날짜 기준으로 센다 (매월 31일이면 31일이 없는 달은 건너뛴다)
create function public.create_event_series(
  p_repeat text,
  p_until date,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_room_id uuid default null,
  p_attendee_ids uuid[] default '{}',
  p_description text default null,
  p_kind text default 'meeting',
  p_subtype text default null,
  p_all_day boolean default false,
  p_location text default null,
  p_visibility text default null,
  p_channel_id uuid default null,
  p_remind_minutes smallint[] default '{10}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  local_start timestamp := p_starts_at at time zone 'Asia/Seoul';
  first_day date := (p_starts_at at time zone 'Asia/Seoul')::date;
  last_day date;
  span interval := p_ends_at - p_starts_at;
  d date;
  starts timestamptz[] := '{}';
  s timestamptz;
  conflict text;
  series uuid := gen_random_uuid();
  ev uuid;
  first_ev uuid;
begin
  if me is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;
  if p_repeat not in ('daily', 'weekly', 'weekdays', 'monthly') then
    raise exception '반복 규칙이 올바르지 않습니다' using errcode = '22023';
  end if;
  if coalesce(p_kind, 'meeting') = 'leave' then
    raise exception '휴가·부재는 반복하지 않습니다' using errcode = '22023';
  end if;
  if span > interval '1 day' or (not coalesce(p_all_day, false) and (p_ends_at at time zone 'Asia/Seoul')::date > first_day + 1) then
    raise exception '하루를 넘는 일정은 반복하지 않습니다' using errcode = '22023';
  end if;
  last_day := least(coalesce(p_until, first_day + 90), first_day + 365);
  if last_day < first_day then
    raise exception '반복 종료일이 시작보다 앞입니다' using errcode = '22023';
  end if;

  d := first_day;
  while d <= last_day and cardinality(starts) < 52 loop
    if (p_repeat = 'daily')
       or (p_repeat = 'weekly' and extract(dow from d) = extract(dow from first_day))
       or (p_repeat = 'weekdays' and extract(isodow from d) between 1 and 5)
       or (p_repeat = 'monthly' and extract(day from d) = extract(day from first_day)) then
      starts := starts || ((d + local_start::time) at time zone 'Asia/Seoul');
    end if;
    d := d + 1;
  end loop;
  if cardinality(starts) = 0 then
    raise exception '만들 회차가 없습니다 (평일 반복인데 주말에 시작하는 등)' using errcode = '22023';
  end if;

  -- 회의실이 겹치는 회차가 있으면 전체를 거부하고 그 날짜를 알려 준다 (누구의 회의인지는 알리지 않는다)
  if p_room_id is not null then
    select string_agg(to_char(x at time zone 'Asia/Seoul', 'FMMM"월 "FMDD"일"'), ', ' order by x) into conflict
    from unnest(starts) as x
    where exists (
      select 1 from public.events e
      where e.room_id = p_room_id and e.canceled_at is null
        and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(x, x + span, '[)'));
    if conflict is not null then
      raise exception '회의실이 이미 예약된 날이 있습니다: %', conflict using errcode = 'P0001', hint = 'room_conflict';
    end if;
  end if;

  perform set_config('app.bulk_event', '1', true);
  foreach s in array starts loop
    ev := public.create_event(p_title, s, s + span, p_room_id, p_attendee_ids, p_description, p_kind, p_subtype,
                              p_all_day, p_location, p_visibility, p_channel_id, p_remind_minutes);
    update public.events set series_id = series, recurrence = p_repeat where id = ev;
    first_ev := coalesce(first_ev, ev);
  end loop;
  perform set_config('app.bulk_event', '', true);

  -- 초대 알림은 사람마다 첫 회차로 한 번만
  insert into public.notifications (user_id, type, event_id)
  select a.user_id, 'event_invite', first_ev
  from public.event_attendees a
  where a.event_id = first_ev and a.user_id <> me
  on conflict (user_id, event_id) where type = 'event_invite' do nothing;
  return first_ev;
end;
$$;

-- ─── "이후 모두" 고치기 ──────────────────────────────
-- 그 회차와 뒤 회차(취소된 것 제외)의 내용·시각·참석자를 바꾼다. 날짜(며칠)는 회차마다 그대로 두고 시각만 바꾼다.
-- 만든 사람만. 알림은 사람마다 한 번 (그 회차로). 참석자는 목록대로 맞춘다 (만든 사람은 늘 남는다)
create function public.update_event_series(
  p_event uuid,
  p_title text,
  p_description text,
  p_kind text,
  p_subtype text,
  p_all_day boolean,
  p_location text,
  p_visibility text,
  p_room_id uuid,
  p_channel_id uuid,
  p_start_time time,
  p_end_time time,
  p_attendee_ids uuid[],
  p_remind_minutes smallint[] default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  target public.events%rowtype;
  r record;
  day date;
  new_start timestamptz;
  new_end timestamptz;
  keep uuid[];
  had uuid[];
  changed integer := 0;
begin
  select * into target from public.events where id = p_event;
  if not found or target.created_by is distinct from me then
    raise exception '만든 사람만 고칠 수 있습니다' using errcode = '42501';
  end if;
  if target.series_id is null then
    raise exception '반복 일정이 아닙니다' using errcode = '22023';
  end if;
  keep := array_append(coalesce(p_attendee_ids, '{}'), me);
  had := array(select user_id from public.event_attendees where event_id = p_event);

  perform set_config('app.bulk_event', '1', true);
  for r in
    select id, starts_at from public.events
    where series_id = target.series_id and starts_at >= target.starts_at and canceled_at is null
    order by starts_at
  loop
    day := (r.starts_at at time zone 'Asia/Seoul')::date;
    if coalesce(p_all_day, false) then
      new_start := day::timestamp at time zone 'Asia/Seoul';
      new_end := (day + 1)::timestamp at time zone 'Asia/Seoul';
    else
      new_start := (day + p_start_time) at time zone 'Asia/Seoul';
      new_end := (day + p_end_time) at time zone 'Asia/Seoul';
      if new_end <= new_start then
        new_end := new_end + interval '1 day';
      end if;
    end if;
    update public.events
    set title = p_title, description = p_description, kind = p_kind, subtype = p_subtype, all_day = coalesce(p_all_day, false),
        location = p_location, visibility = coalesce(p_visibility, visibility), room_id = p_room_id, channel_id = p_channel_id,
        starts_at = new_start, ends_at = new_end
    where id = r.id;
    delete from public.event_attendees where event_id = r.id and user_id <> all (keep);
    insert into public.event_attendees (event_id, user_id, remind_minutes)
    select r.id, p.id, case when coalesce(p_all_day, false) then '{}'::smallint[] else '{10}'::smallint[] end
    from public.profiles p where p.id = any (keep) and p.id <> me
    on conflict do nothing;
    if p_remind_minutes is not null then
      update public.event_attendees set remind_minutes = p_remind_minutes where event_id = r.id and user_id = me;
    end if;
    changed := changed + 1;
  end loop;
  perform set_config('app.bulk_event', '', true);

  -- 알림은 그 회차로 한 번씩: 원래 있던 사람(불참 제외)은 변경, 새로 들어온 사람은 초대
  insert into public.notifications (user_id, type, event_id)
  select a.user_id, 'event_update', p_event
  from public.event_attendees a
  where a.event_id = p_event and a.user_id <> me and a.response <> 'declined' and a.user_id = any (had);
  insert into public.notifications (user_id, type, event_id)
  select a.user_id, 'event_invite', p_event
  from public.event_attendees a
  where a.event_id = p_event and a.user_id <> me and a.user_id <> all (had)
  on conflict (user_id, event_id) where type = 'event_invite' do nothing;
  return changed;
end;
$$;

-- ─── "이후 모두" 취소 ────────────────────────────────
create function public.cancel_event_series(p_event uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  target public.events%rowtype;
  changed integer;
begin
  select * into target from public.events where id = p_event;
  if not found or target.created_by is distinct from me then
    raise exception '만든 사람만 취소할 수 있습니다' using errcode = '42501';
  end if;
  if target.series_id is null then
    raise exception '반복 일정이 아닙니다' using errcode = '22023';
  end if;
  perform set_config('app.bulk_event', '1', true);
  update public.events set canceled_at = now()
  where series_id = target.series_id and starts_at >= target.starts_at and canceled_at is null;
  get diagnostics changed = row_count;
  perform set_config('app.bulk_event', '', true);
  insert into public.notifications (user_id, type, event_id)
  select a.user_id, 'event_cancel', p_event
  from public.event_attendees a
  where a.event_id = p_event and a.user_id <> me and a.response <> 'declined';
  return changed;
end;
$$;

-- ─── 참석자와 대화 ───────────────────────────────────
-- 참석자만. 상대가 한 명이면 DM 을 연다. 여럿이면 일정에 이은 비공개 채널을 쓰고(없으면 만든다),
-- 그 뒤에 들어온 참석자도 멤버로 넣는다. 돌려주는 값은 채널 id
create function public.open_event_chat(p_event uuid) returns uuid
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
  if ch is null or not exists (select 1 from public.channels where id = ch) then
    insert into public.channels (name, type, created_by)
    values (left(ev.title, 40), 'private', me)
    returning id into ch;
    update public.events set chat_channel_id = ch where id = p_event;
  end if;
  insert into public.memberships (channel_id, user_id)
  select ch, a.user_id from public.event_attendees a where a.event_id = p_event
  on conflict do nothing;
  return ch;
end;
$$;

revoke execute on function
  public.event_bulk(),
  public.create_event_series(text, date, text, timestamptz, timestamptz, uuid, uuid[], text, text, text, boolean, text, text, uuid, smallint[]),
  public.update_event_series(uuid, text, text, text, text, boolean, text, text, uuid, uuid, time, time, uuid[], smallint[]),
  public.cancel_event_series(uuid),
  public.open_event_chat(uuid)
from public, anon;
grant execute on function
  public.create_event_series(text, date, text, timestamptz, timestamptz, uuid, uuid[], text, text, text, boolean, text, text, uuid, smallint[]),
  public.update_event_series(uuid, text, text, text, text, boolean, text, text, uuid, uuid, time, time, uuid[], smallint[]),
  public.cancel_event_series(uuid),
  public.open_event_chat(uuid)
to authenticated;
