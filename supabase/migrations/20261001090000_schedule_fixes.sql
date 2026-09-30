-- 일정 개편 1차 검토 반영 (2026-10-01, 김송이 ②, WU-42 — 20260930230000_schedule_v2.sql 은 원격 적용돼 고치지 않는다)
--   1) list_team_events: "바쁨" 칸은 유형(kind)도 비운다. 전에는 화면만 회색이고 API 로는 업무·개인이 보였다
--   2) send_event_reminders: 30분보다 이른 알림(1시간·하루 전)은 알릴 시각이 지난 지 5분 안에만 보낸다.
--      전에는 created_at 만 봐서, 시작을 앞당기거나 이미 지난 알림을 새로 켜면 곧바로 틀린 문구("내일 시작")로 갔다
--   3) create_event: 종일 일정의 초대자는 알림 없이 넣는다. 전에는 기본값 {10} 이라 전날 23:50 에 "10분 후 시작"이 갔다

create or replace function public.list_team_events(p_from timestamptz, p_to timestamptz)
returns table (event_id uuid, user_id uuid, kind text, starts_at timestamptz, ends_at timestamptz,
               all_day boolean, label text, title text, location text, assignees uuid[])
language sql stable security definer set search_path = '' as $$
  select e.id, e.created_by,
         -- 업무·개인을 시간만 공개하면 "바쁨"뿐이다 — 유형도 주지 않는다
         case when e.kind in ('work', 'personal') and not (e.visibility = 'public') then null else e.kind end,
         e.starts_at, e.ends_at, e.all_day,
         case
           when e.kind = 'leave' and e.visibility = 'public' then
             case e.subtype when 'annual' then '연차' when 'half' then '반차' when 'sick' then '휴가'
                            when 'leave_of_absence' then '부재' when 'other' then '기타 부재' else '부재' end
           when e.kind = 'leave' then '부재'
           when e.kind = 'outside' then '외근'
           when e.kind = 'personal' and e.visibility = 'public' then '개인 일정'
           when e.kind = 'work' and e.visibility = 'public' then '업무'
           else '바쁨'
         end,
         case when e.visibility = 'public' and e.kind in ('work', 'outside') then e.title end,
         case when e.visibility = 'public' and e.kind = 'outside' then e.location end,
         case when e.visibility = 'public' and e.kind = 'work' then
           (select array_agg(a.user_id order by a.user_id) from public.event_attendees a where a.event_id = e.id)
         end
  from public.events e
  join public.profiles owner on owner.id = e.created_by
  join public.profiles me on me.id = (select auth.uid())
  where e.kind <> 'meeting'
    and e.visibility <> 'private'
    and e.canceled_at is null
    and e.created_by <> me.id
    and not exists (select 1 from public.event_attendees x where x.event_id = e.id and x.user_id = me.id)
    and me.org_unit_id is not null
    and owner.org_unit_id = me.org_unit_id
    and p_to > p_from
    and p_to - p_from <= interval '62 days'
    and e.starts_at < p_to
    and e.ends_at > p_from
  order by e.starts_at;
$$;

create or replace function public.send_event_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  inserted integer;
begin
  insert into public.notifications (user_id, type, event_id, remind_minutes)
  select a.user_id, 'event_reminder', e.id, m.minutes
  from public.events e
  join public.event_attendees a on a.event_id = e.id
  cross join lateral unnest(a.remind_minutes) as m (minutes)
  where e.canceled_at is null
    and a.response <> 'declined'
    and e.starts_at > now()
    and e.starts_at <= now() + interval '1 day'
    and e.starts_at - make_interval(mins => m.minutes) <= now()
    -- 10분 전까지는 늦어도 보낸다 (예전 동작). 1시간·하루 전은 그 시각을 5분 넘게 지났으면 보내지 않는다
    and (m.minutes <= 30 or now() - (e.starts_at - make_interval(mins => m.minutes)) < interval '5 minutes')
  on conflict (user_id, event_id, remind_minutes) where type = 'event_reminder' do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.create_event(
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
  event uuid;
begin
  if me is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  -- 공개 범위를 주지 않으면 개인은 시간만 공개, 나머지는 팀에 공개
  insert into public.events (title, description, starts_at, ends_at, room_id, created_by,
                             kind, subtype, all_day, location, visibility, channel_id)
  values (p_title, p_description, p_starts_at, p_ends_at, p_room_id, me,
          coalesce(p_kind, 'meeting'), p_subtype, coalesce(p_all_day, false), p_location,
          coalesce(p_visibility, case when p_kind = 'personal' then 'time_only' else 'public' end),
          p_channel_id)
  returning id into event;

  insert into public.event_attendees (event_id, user_id, response, responded_at, remind_minutes)
  values (event, me, 'accepted', now(), coalesce(p_remind_minutes, '{}'));

  -- 초대자는 기본 알림. 종일 일정이면 알림 없이 (0시 10분 전 = 전날 23:50 이 되므로)
  insert into public.event_attendees (event_id, user_id, remind_minutes)
  select event, p.id, case when coalesce(p_all_day, false) then '{}'::smallint[] else '{10}'::smallint[] end
  from public.profiles p
  where p.id = any (coalesce(p_attendee_ids, '{}')) and p.id <> me
  on conflict do nothing;
  return event;
end;
$$;
