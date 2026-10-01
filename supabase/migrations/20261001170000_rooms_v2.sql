-- 회의실 예약 개편 (2026-10-01, WU-46). 제안서 "WorkOn 회의실 예약 개편안"에서 사용자와 정한 것:
--   회의실 8개 + 시설 · 30분 단위 · 30분~4시간(관리자는 길이만 예외) · 08:00~21:00 · 오늘부터 90일 · 지난 시각 금지 ·
--   한 사람이 같은 시간에 두 회의실 금지 · 진행 중이면 시작·회의실 고정(종료만 바꿈 = 일찍 끝내기) · 시작한 예약은 취소 없음 ·
--   공개 회의(예약자 이름·부서 공개) / 비공개 회의(예약자 숨김, 관리자에게도) — events.visibility 를 회의에도 쓴다 (public 만 공개).
-- 지금 있는 예약은 건드리지 않는다. 규칙은 회의실 일정을 새로 넣거나 시각·회의실을 바꿀 때만 따진다.
-- 서비스 키(시드·검사 스크립트, auth.uid() 가 없음)는 규칙을 건너뛴다.

-- ─── 회의실 칸 ─────────────────────────────────────────
alter table public.rooms
  add column facilities text[] not null default '{}'
    constraint rooms_facilities check (facilities <@ array['monitor', 'video', 'whiteboard', 'projector', 'mic']::text[]),
  add column description text constraint rooms_description check (char_length(description) <= 100),
  add column sort_order smallint not null default 100;

-- 지금 있는 3개는 이름을 그대로 두고 (시드·검사 스크립트가 이름으로 찾는다) 시설·순서만 채운다
update public.rooms set facilities = '{monitor,whiteboard}', sort_order = 20 where name = '회의실 1 (소)';
update public.rooms set facilities = '{monitor,video,whiteboard}', sort_order = 30 where name = '회의실 2 (중)';
update public.rooms set facilities = '{projector,video,whiteboard,mic}', sort_order = 70 where name = '회의실 3 (대)';
insert into public.rooms (name, capacity, location, facilities, description, sort_order) values
  ('포커스룸', 2, '3층', '{monitor}', '1:1 · 전화 회의', 10),
  ('회의실 4 (소)', 4, '4층', '{monitor}', null, 40),
  ('회의실 5 (중)', 6, '4층', '{video,whiteboard}', null, 50),
  ('회의실 6 (중)', 10, '4층', '{projector,video,whiteboard}', null, 60),
  ('세미나실', 30, '5층', '{projector,video,mic}', '발표 · 교육', 80)
on conflict (name) do nothing;

-- ─── 정책 숫자 (화면 components/rooms/policy.ts 와 같다) ───
create function public.room_policy()
returns table (slot_minutes int, min_minutes int, max_minutes int, open_time time, close_time time, window_days int)
language sql immutable set search_path = '' as $$
  select 30, 30, 240, time '08:00', time '21:00', 90;
$$;

-- ─── 회의실 예약 규칙 ─────────────────────────────────────
create function public.events_room_policy() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  me uuid := (select auth.uid());
  k_start timestamp := new.starts_at at time zone 'Asia/Seoul';
  k_end timestamp := new.ends_at at time zone 'Asia/Seoul';
  today date := (now() at time zone 'Asia/Seoul')::date;
  now_slot timestamptz;
  len int;
  moved boolean;
  other text;
begin
  if me is null or new.room_id is null then
    return new;
  end if;
  select * into p from public.room_policy();
  now_slot := date_bin(make_interval(mins => p.slot_minutes), now(), timestamptz '2000-01-01 00:00+09');

  -- 취소: 시작한 예약은 취소하지 않는다 (진행 중이면 일찍 끝내기 — 기록을 남긴다)
  if tg_op = 'UPDATE' and new.canceled_at is not null then
    if old.canceled_at is null and old.room_id is not null and old.starts_at <= now() then
      raise exception '이미 시작한 회의실 예약은 취소할 수 없습니다. 진행 중이면 [일찍 끝내기]로 남은 시간을 돌려주세요'
        using errcode = 'P0001', hint = 'room_policy';
    end if;
    return new;
  end if;
  if new.canceled_at is not null then
    return new;
  end if;

  -- 시각·회의실을 그대로 두는 고치기(제목·참석자·메모·공개)는 따지지 않는다
  if tg_op = 'UPDATE' and old.canceled_at is null and new.room_id is not distinct from old.room_id
     and new.starts_at = old.starts_at and new.ends_at = old.ends_at then
    return new;
  end if;

  moved := tg_op = 'INSERT' or old.canceled_at is not null
           or new.starts_at <> old.starts_at or new.room_id is distinct from old.room_id;

  if tg_op = 'UPDATE' and old.canceled_at is null and old.room_id is not null then
    if old.ends_at <= now() then
      raise exception '끝난 회의실 예약은 시각이나 회의실을 바꿀 수 없습니다' using errcode = 'P0001', hint = 'room_policy';
    end if;
    if old.starts_at <= now() and (new.starts_at <> old.starts_at or new.room_id is distinct from old.room_id) then
      raise exception '진행 중인 예약은 시작 시각과 회의실을 바꿀 수 없습니다. 종료 시각만 바꿀 수 있습니다'
        using errcode = 'P0001', hint = 'room_policy';
    end if;
  end if;

  if new.all_day then
    raise exception '회의실은 종일로 예약할 수 없습니다. 시간을 정해 주세요 (%~%)',
      to_char(p.open_time, 'HH24:MI'), to_char(p.close_time, 'HH24:MI') using errcode = 'P0001', hint = 'room_policy';
  end if;
  if date_trunc('minute', k_start) <> k_start or date_trunc('minute', k_end) <> k_end
     or extract(minute from k_start)::int % p.slot_minutes <> 0 or extract(minute from k_end)::int % p.slot_minutes <> 0 then
    raise exception '회의실은 %분 단위로 예약합니다 (시작·종료가 :00 이나 :30)', p.slot_minutes using errcode = 'P0001', hint = 'room_policy';
  end if;
  if k_start::date <> k_end::date or k_start::time < p.open_time or k_end::time > p.close_time then
    raise exception '회의실은 하루 안에서 %~% 사이로만 예약할 수 있습니다',
      to_char(p.open_time, 'HH24:MI'), to_char(p.close_time, 'HH24:MI') using errcode = 'P0001', hint = 'room_policy';
  end if;
  len := extract(epoch from new.ends_at - new.starts_at)::int / 60;
  if len < p.min_minutes then
    raise exception '회의실은 %분 이상 예약합니다', p.min_minutes using errcode = 'P0001', hint = 'room_policy';
  end if;
  if len > p.max_minutes and not public.is_admin() then
    raise exception '회의실은 한 번에 최대 %시간까지 예약할 수 있습니다', p.max_minutes / 60 using errcode = 'P0001', hint = 'room_policy';
  end if;
  if k_start::date > today + p.window_days then
    raise exception '회의실은 오늘부터 %일(%)까지만 예약할 수 있습니다',
      p.window_days, to_char(today + p.window_days, 'FMMM"월 "FMDD"일"') using errcode = 'P0001', hint = 'room_policy';
  end if;
  if moved and new.starts_at < now_slot then
    raise exception '지난 시각은 예약할 수 없습니다 (지금 들어 있는 30분 칸부터 됩니다)' using errcode = 'P0001', hint = 'room_policy';
  end if;
  if not moved and new.ends_at < now_slot then
    raise exception '지난 시각으로 끝낼 수 없습니다' using errcode = 'P0001', hint = 'room_policy';
  end if;

  -- 한 사람이 같은 시간에 두 회의실을 잡을 수 없다 (예약자 = 만든 사람 기준)
  select r.name into other
  from public.events e join public.rooms r on r.id = e.room_id
  where e.created_by = new.created_by and e.id <> new.id and e.canceled_at is null
    and e.room_id is not null and e.room_id <> new.room_id
    and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  limit 1;
  if other is not null then
    raise exception '같은 시간에 % 예약이 있습니다. 한 사람이 같은 시간에 회의실 두 곳을 잡을 수 없습니다', other
      using errcode = 'P0001', hint = 'room_policy';
  end if;
  return new;
end;
$$;

create trigger events_room_policy
  before insert or update of starts_at, ends_at, room_id, all_day, canceled_at on public.events
  for each row execute function public.events_room_policy();

-- ─── 회의실 시간표 ───────────────────────────────────────
-- 모든 회의실의 예약을 한 번에 (회의실마다 room_busy 를 부르지 않게). 남의 예약은
--   공개(visibility = public): 시각 · 예약자 이름 · 부서 / 비공개: 시각만 (관리자에게도)
--   내가 만든 사람이거나 참석자면: 일정 id · 제목도 (어차피 내 캘린더에 있는 일정)
-- 한 번에 8일까지 (날짜 하나 또는 대시보드 오늘)
create function public.room_board(p_from timestamptz, p_to timestamptz)
returns table (
  event_id uuid, room_id uuid, starts_at timestamptz, ends_at timestamptz,
  is_private boolean, booker_id uuid, booker_name text, booker_unit text, mine boolean, title text
)
language sql stable security definer set search_path = '' as $$
  select
    case when x.part then e.id end,
    e.room_id, e.starts_at, e.ends_at,
    e.visibility <> 'public',
    case when x.part or e.visibility = 'public' then e.created_by end,
    case when x.part or e.visibility = 'public' then pr.display_name end,
    case when x.part or e.visibility = 'public' then ou.name end,
    e.created_by = (select auth.uid()),
    case when x.part then e.title end
  from public.events e
  join public.profiles pr on pr.id = e.created_by
  left join public.org_units ou on ou.id = pr.org_unit_id
  cross join lateral (select public.is_event_participant(e.id) as part) x
  where (select auth.uid()) is not null
    and p_to > p_from and p_to - p_from <= interval '8 days'
    and e.room_id is not null and e.canceled_at is null
    and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
  order by e.starts_at;
$$;

revoke execute on function public.room_policy(), public.room_board(timestamptz, timestamptz), public.events_room_policy() from public, anon;
grant execute on function public.room_policy(), public.room_board(timestamptz, timestamptz) to authenticated;
