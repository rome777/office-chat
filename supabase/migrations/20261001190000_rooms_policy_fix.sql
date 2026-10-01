-- 회의실 정책 트리거 고침 (2026-10-01, WU-46 별도 검토 반영). 20261001170000 이 원격에 적용돼 새 파일로 바꾼다.
--   ① [높음] 시작한 예약에서 회의실을 빼면(room_id → null) "시작한 예약은 취소 없음"을 피해 자리가 비고 기록이 사라졌다 → 거부
--   ② 시각·회의실을 그대로 둔 고치기를 건너뛰는 조건에 all_day 가 없어 회의실 예약을 종일로 바꿀 수 있었다 → 종일 바꾸기도 따진다
--   ③ 정책 전에 들어간 예약(:15 시작, 4시간 넘음)은 일찍 끝내기·종료 바꾸기가 시작 칸·길이 검사에 걸렸다
--      → 시작·회의실을 그대로 두면(종료만 바꾸면) 시작 쪽 검사(단위·운영 시작·최소 길이·90일·지난 시각)는 하지 않고,
--        종료가 30분 칸·21시 안·지금 칸 뒤인지와, 늘릴 때만 최대 길이를 본다
--   ④ "두 곳 금지"를 잠금 없이 확인해 동시에 두 요청이 오면 둘 다 들어갈 수 있었다 → 예약자마다 트랜잭션 잠금.
--      그리고 새로 잡거나 옮기거나 늘릴 때만 본다 (종료를 줄이는 일찍 끝내기가 예전 겹침 때문에 막히지 않게)

create or replace function public.events_room_policy() returns trigger
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
  if me is null then
    return new;
  end if;

  -- ① 시작한 예약에서 회의실을 빼지 않는다 (진행 중이면 일찍 끝내기, 끝났으면 기록으로 남긴다)
  if tg_op = 'UPDATE' and old.room_id is not null and new.room_id is null
     and old.canceled_at is null and new.canceled_at is null and old.starts_at <= now() then
    raise exception '이미 시작한 예약에서는 회의실을 뺄 수 없습니다. 진행 중이면 [일찍 끝내기]로 남은 시간을 돌려주세요'
      using errcode = 'P0001', hint = 'room_policy';
  end if;
  if new.room_id is null then
    return new;
  end if;
  select * into p from public.room_policy();
  now_slot := date_bin(make_interval(mins => p.slot_minutes), now(), timestamptz '2000-01-01 00:00+09');

  -- 취소: 시작한 예약은 취소하지 않는다
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

  -- ② 시각·회의실·종일을 그대로 두는 고치기(제목·참석자·메모·공개)는 따지지 않는다
  if tg_op = 'UPDATE' and old.canceled_at is null and new.room_id is not distinct from old.room_id
     and new.starts_at = old.starts_at and new.ends_at = old.ends_at and new.all_day is not distinct from old.all_day then
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
  -- 종료는 늘 30분 칸·21시 안 (하루 안)
  if date_trunc('minute', k_end) <> k_end or extract(minute from k_end)::int % p.slot_minutes <> 0
     or (moved and (date_trunc('minute', k_start) <> k_start or extract(minute from k_start)::int % p.slot_minutes <> 0)) then
    raise exception '회의실은 %분 단위로 예약합니다 (시작·종료가 :00 이나 :30)', p.slot_minutes using errcode = 'P0001', hint = 'room_policy';
  end if;
  if k_start::date <> k_end::date or k_end::time > p.close_time or (moved and k_start::time < p.open_time) then
    raise exception '회의실은 하루 안에서 %~% 사이로만 예약할 수 있습니다',
      to_char(p.open_time, 'HH24:MI'), to_char(p.close_time, 'HH24:MI') using errcode = 'P0001', hint = 'room_policy';
  end if;
  len := extract(epoch from new.ends_at - new.starts_at)::int / 60;
  if moved and len < p.min_minutes then
    raise exception '회의실은 %분 이상 예약합니다', p.min_minutes using errcode = 'P0001', hint = 'room_policy';
  end if;
  -- ③ 최대 길이는 새로 잡거나 옮기거나 종료를 늘릴 때만 (줄이는 것은 늘 된다)
  if len > p.max_minutes and (moved or new.ends_at > old.ends_at) and not public.is_admin() then
    raise exception '회의실은 한 번에 최대 %시간까지 예약할 수 있습니다', p.max_minutes / 60 using errcode = 'P0001', hint = 'room_policy';
  end if;
  if moved and k_start::date > today + p.window_days then
    raise exception '회의실은 오늘부터 %일(%)까지만 예약할 수 있습니다',
      p.window_days, to_char(today + p.window_days, 'FMMM"월 "FMDD"일"') using errcode = 'P0001', hint = 'room_policy';
  end if;
  if moved and new.starts_at < now_slot then
    raise exception '지난 시각은 예약할 수 없습니다 (지금 들어 있는 30분 칸부터 됩니다)' using errcode = 'P0001', hint = 'room_policy';
  end if;
  if not moved and new.ends_at <= now_slot then
    raise exception '지난 시각으로 끝낼 수 없습니다 (지금 칸이 끝나는 시각부터 됩니다)' using errcode = 'P0001', hint = 'room_policy';
  end if;

  -- ④ 한 사람이 같은 시간에 두 회의실을 잡을 수 없다 — 같은 예약자의 동시 요청은 차례로 확인한다. 줄이기만 하면 보지 않는다
  if not moved and new.ends_at <= old.ends_at then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('room_policy:' || new.created_by::text, 0));
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

revoke execute on function public.events_room_policy() from public, anon;
