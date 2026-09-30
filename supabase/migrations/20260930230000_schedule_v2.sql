-- 일정 개편 1차 (2026-09-30~10-01, 김송이 ②, WU-41·42 — TECH_SPEC 7절 "일정").
--
--   events           유형 kind(회의·업무·개인·외근·휴가/부재) · 세부 유형 subtype · 종일 all_day · 장소 location
--                    공개 범위 visibility(public 팀에 공개 · time_only 시간만 공개 · private 나만 보기 — 회의는 쓰지 않는다)
--                    만든 채널 channel_id · 분류 category(team·project·mine) + team_unit_id
--   event_attendees  사람마다 시작 전 알림 remind_minutes (5·10·30·60·1440분 전, 기본 {10} — 지금의 "10분 전"과 같다)
--   notifications    몇 분 전 알림인지 remind_minutes. 유일 조건을 초대 하나 / (사람, 일정, 알림 시각) 하나로 나눈다
--
-- 일정 권한(RLS)은 그대로 "만든 사람·참석자만" 이다. 같은 부서(소속 조직) 팀원에게는 list_team_events() 가
-- 공개 범위에 맞게 가린 칸만 준다 (회의는 주지 않는다, 나만 보기도 주지 않는다):
--   유형       팀에 공개                            시간만 공개
--   업무       일정명 · 시작~마감 · 담당자(참석자)     "바쁨" + 시간
--   개인       "개인 일정" + 시간                     "바쁨" + 시간
--   외근       일정명 · 장소 · 시간                   "외근" + 시간
--   휴가·부재  종류(연차·반차·기타 부재) + 기간        "부재" + 기간
--              병가는 "휴가", 휴직은 "부재"로만 (건강·인사 정보)
-- 기본값: 개인은 시간만 공개, 나머지는 팀에 공개 (create_event 가 정한다).
--
-- 분류는 저장할 때 정해 기록한다 (볼 때마다 따지면 새 팀원이 오거나 조직이 바뀔 때 지난 일정이 저절로 바뀐다).
-- 만들 때, 참석자가 들고 날 때, 유형이나 채널을 바꿀 때만 다시 정한다.
--   1) 회의·업무이고, 어떤 조직(하위 조직 포함, 2명 이상)의 사람이 모두 참석자다 → team (그런 조직 중 가장 큰 것)
--      불참으로 답한 사람도 초대받았으면 포함한다
--   2) 1이 아니고, 부서 채널이 아닌 일반 채널(DM 제외)에서 만들었다 → project
--   3) 나머지 → mine
--
-- 새 칸은 모두 기본값이 있어서 지금 운영 화면(create_event 6개 인자)이 그대로 동작한다.

-- ─── events ──────────────────────────────────────────
alter table public.events
  add column kind text not null default 'meeting'
    constraint events_kind check (kind in ('meeting', 'work', 'personal', 'outside', 'leave')),
  add column subtype text,
  add column all_day boolean not null default false,
  add column location text
    constraint events_location check (location ~ '\S' and char_length(location) <= 100),
  add column visibility text not null default 'public'
    constraint events_visibility check (visibility in ('public', 'time_only', 'private')),
  add column channel_id uuid references public.channels (id) on delete set null,
  add column category text not null default 'mine'
    constraint events_category check (category in ('mine', 'team', 'project')),
  add column team_unit_id uuid references public.org_units (id) on delete set null,
  -- 세부 유형은 그 유형의 것만 (비워 둘 수는 있다)
  add constraint events_subtype check (subtype is null or subtype = any (case kind
    when 'meeting'  then array['meeting', 'team_meeting', 'project_talk', 'one_on_one']
    when 'work'     then array['deadline', 'design', 'project', 'focus']
    when 'personal' then array['appointment', 'hospital', 'errand', 'meal', 'anniversary']
    when 'outside'  then array['client_visit', 'trip', 'external_meeting', 'site_visit']
    when 'leave'    then array['annual', 'half', 'sick', 'leave_of_absence', 'other']
  end));

-- 분류(category·team_unit_id)는 트리거만 쓴다 → 사용자에게 주지 않는다
grant insert (kind, subtype, all_day, location, visibility, channel_id) on public.events to authenticated;
grant update (kind, subtype, all_day, location, visibility, channel_id) on public.events to authenticated;

-- ─── event_attendees ─────────────────────────────────
-- 1440 = 하루 전. 빈 배열 = 알림 없음
alter table public.event_attendees
  add column remind_minutes smallint[] not null default '{10}'
    constraint event_attendees_remind check (
      cardinality(remind_minutes) <= 5 and remind_minutes <@ '{5,10,30,60,1440}'::smallint[]);
-- 본인 행만 고칠 수 있다 (정책 "본인 응답만 수정")
grant update (remind_minutes) on public.event_attendees to authenticated;

-- ─── notifications ───────────────────────────────────
alter table public.notifications add column remind_minutes smallint;
update public.notifications set remind_minutes = 10 where type = 'event_reminder' and remind_minutes is null;
drop index public.notifications_one_per_event;
create unique index notifications_one_invite on public.notifications (user_id, event_id)
  where type = 'event_invite';
create unique index notifications_one_reminder on public.notifications (user_id, event_id, remind_minutes)
  where type = 'event_reminder';

-- 초대 알림: 유일 인덱스가 바뀌어서 on conflict 를 맞춘다 (나머지는 20260929140000 과 같다)
create or replace function public.event_attendees_notify_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.events e where e.id = new.event_id and e.created_by = new.user_id) then
    return null; -- 만든 사람 자신
  end if;
  insert into public.notifications (user_id, type, event_id)
  values (new.user_id, 'event_invite', new.event_id)
  on conflict (user_id, event_id) where type = 'event_invite' do nothing;
  return null;
end;
$$;

-- 변경 알림: 종일·장소가 바뀌어도 알린다
create or replace function public.events_notify_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  kind text;
begin
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
    return null; -- 설명·분류만 바뀌었거나 취소된 일정을 고친 경우
  end if;

  if new.starts_at is distinct from old.starts_at then
    delete from public.notifications where event_id = new.id and type = 'event_reminder';
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

-- 시작 전 알림: 참석자마다 고른 시각에. pg_cron 작업 event-reminders(1분마다)가 그대로 부른다.
-- 30분보다 이른 알림(1시간·하루 전)은 그 시각이 지난 뒤에 만든 일정이면 보내지 않는다 (만들자마자 "하루 전" 알림이 오지 않게)
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
    and (m.minutes <= 30 or e.created_at <= e.starts_at - make_interval(mins => m.minutes))
  on conflict (user_id, event_id, remind_minutes) where type = 'event_reminder' do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- ─── 분류 ────────────────────────────────────────────
create function public.event_classify(p_event uuid, p_kind text, p_channel uuid,
  out o_category text, out o_unit uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  o_unit := null;
  if p_kind in ('meeting', 'work') then
    with recursive tree (root, node) as (
      select u.id, u.id from public.org_units u
      union all
      select t.root, c.id from tree t join public.org_units c on c.parent_id = t.node
    ), covered as (
      select t.root, count(*) as members
      from tree t
      join public.profiles p on p.org_unit_id = t.node
      left join public.event_attendees a on a.event_id = p_event and a.user_id = p.id
      group by t.root
      having count(*) >= 2 and count(a.user_id) = count(*)
    )
    select c.root into o_unit from covered c order by c.members desc, c.root limit 1;
    if o_unit is not null then
      o_category := 'team';
      return;
    end if;
  end if;
  if p_channel is not null
     and exists (select 1 from public.channels c where c.id = p_channel and c.type <> 'dm')
     and not public.is_org_channel(p_channel) then
    o_category := 'project';
    return;
  end if;
  o_category := 'mine';
end;
$$;

-- 만들 때·유형이나 채널을 바꿀 때. 채널은 내가 멤버인 곳만 고를 수 있다 (검사 스크립트의 service role 은 auth.uid() 가 없어 건너뛴다)
create function public.events_classify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.channel_id is not null
     and (tg_op = 'INSERT' or new.channel_id is distinct from old.channel_id)
     and (select auth.uid()) is not null
     and not public.is_member(new.channel_id) then
    raise exception '그 채널의 멤버가 아닙니다' using errcode = '42501';
  end if;
  select c.o_category, c.o_unit into new.category, new.team_unit_id
  from public.event_classify(new.id, new.kind, new.channel_id) c;
  return new;
end;
$$;
create trigger events_classify
  before insert or update of kind, channel_id on public.events
  for each row execute function public.events_classify();

-- 참석자가 들고 날 때
create function public.event_attendees_classify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ev uuid;
  ev_kind text;
  ev_channel uuid;
  cat text;
  unit uuid;
begin
  if tg_op = 'DELETE' then
    ev := old.event_id;
  else
    ev := new.event_id;
  end if;
  select e.kind, e.channel_id into ev_kind, ev_channel from public.events e where e.id = ev;
  if not found then
    return null; -- 일정이 지워지면서 참석자가 함께 지워지는 중
  end if;
  select c.o_category, c.o_unit into cat, unit from public.event_classify(ev, ev_kind, ev_channel) c;
  update public.events
  set category = cat, team_unit_id = unit
  where id = ev and (category, team_unit_id) is distinct from (cat, unit);
  return null;
end;
$$;
create trigger event_attendees_classify
  after insert or delete on public.event_attendees
  for each row execute function public.event_attendees_classify();

-- 지금 있는 일정도 한 번 정한다 (모두 kind = meeting, channel_id 없음 → team 아니면 mine)
update public.events e
set (category, team_unit_id) = (
  select c.o_category, c.o_unit from public.event_classify(e.id, e.kind, e.channel_id) c);

-- ─── 일정 만들기 (새 판) ─────────────────────────────
-- 인자를 뒤에 더했다. 모두 기본값이 있어서 예전 6개 인자 호출도 그대로 된다 (supabase-js 는 이름으로 부른다)
drop function public.create_event(text, timestamptz, timestamptz, uuid, uuid[], text);
create function public.create_event(
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

  insert into public.event_attendees (event_id, user_id)
  select event, p.id
  from public.profiles p
  where p.id = any (coalesce(p_attendee_ids, '{}')) and p.id <> me
  on conflict do nothing;
  return event;
end;
$$;

-- ─── 같은 부서 팀원의 일정 (공개 범위에 맞게 가려서) ───
-- 일정 권한(RLS)의 유일한 예외. 같은 소속 조직 사람이 만든 일정 중 회의가 아니고 "나만 보기"가 아닌 것.
-- 내가 참석자인 일정은 뺀다 (그건 내 일정으로 이미 다 보인다). 칸은 머리말의 표대로만 채운다. 한 번에 62일까지.
create function public.list_team_events(p_from timestamptz, p_to timestamptz)
returns table (event_id uuid, user_id uuid, kind text, starts_at timestamptz, ends_at timestamptz,
               all_day boolean, label text, title text, location text, assignees uuid[])
language sql stable security definer set search_path = '' as $$
  select e.id, e.created_by, e.kind, e.starts_at, e.ends_at, e.all_day,
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

revoke execute on function
  public.create_event(text, timestamptz, timestamptz, uuid, uuid[], text, text, text, boolean, text, text, uuid, smallint[]),
  public.list_team_events(timestamptz, timestamptz),
  public.event_classify(uuid, text, uuid),
  public.events_classify(),
  public.event_attendees_classify()
from public, anon;
revoke execute on function
  public.event_classify(uuid, text, uuid), public.events_classify(), public.event_attendees_classify()
from authenticated;
grant execute on function
  public.create_event(text, timestamptz, timestamptz, uuid, uuid[], text, text, text, boolean, text, text, uuid, smallint[]),
  public.list_team_events(timestamptz, timestamptz)
to authenticated;
