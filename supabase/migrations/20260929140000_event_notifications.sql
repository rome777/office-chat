-- 일정 알림 만들기 (일정 알림 작업, 2026-09-29, TECH_SPEC 7절 "캘린더·회의 예약 — 일정 알림 만들기").
--   event_invite    event_attendees INSERT          새 참석자 (만든 사람 제외)
--   event_update    events UPDATE (제목·시각·회의실)  거절하지 않은 참석자 (고친 사람 제외)
--   event_cancel    events UPDATE (canceled_at 채움) 거절하지 않은 참석자 (취소한 사람 제외)
--   event_reminder  pg_cron 1분마다                  10분 안에 시작하고 취소되지 않은 회의의, 거절하지 않은 참석자 (만든 사람 포함)
-- 초대·10분 전 알림은 유일 인덱스(notifications_one_per_event) 덕분에 한 번만 들어간다 (pg_cron 이 여러 번 돌아도).
-- 시작 시각이 바뀌면 그 회의의 10분 전 알림을 지워서 새 시각에 다시 보낸다.
-- 알림을 띄우는 쪽(목록·토스트·브라우저 알림)은 메시지 알림과 같다 (components/notifications).

create function public.event_attendees_notify_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.events e where e.id = new.event_id and e.created_by = new.user_id) then
    return null; -- 만든 사람 자신
  end if;
  insert into public.notifications (user_id, type, event_id)
  values (new.user_id, 'event_invite', new.event_id)
  on conflict (user_id, event_id, type) where type in ('event_invite', 'event_reminder') do nothing;
  return null;
end;
$$;
create trigger event_attendees_notify_invite
  after insert on public.event_attendees
  for each row execute function public.event_attendees_notify_invite();

create function public.events_notify_change() returns trigger
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
  ) then
    kind := 'event_update';
  else
    return null; -- 설명만 바꿨거나 취소된 회의를 고친 경우
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
create trigger events_notify_change
  after update on public.events
  for each row execute function public.events_notify_change();

-- 10분 전 알림. 새로 넣은 알림 수를 돌려준다
create function public.send_event_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  inserted integer;
begin
  insert into public.notifications (user_id, type, event_id)
  select a.user_id, 'event_reminder', e.id
  from public.events e
  join public.event_attendees a on a.event_id = e.id
  where e.canceled_at is null
    and a.response <> 'declined'
    and e.starts_at > now()
    and e.starts_at <= now() + interval '10 minutes'
  on conflict (user_id, event_id, type) where type in ('event_invite', 'event_reminder') do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke execute on function public.event_attendees_notify_invite(), public.events_notify_change(), public.send_event_reminders()
  from public, anon, authenticated;
grant execute on function public.send_event_reminders() to service_role; -- 검사 스크립트가 바로 부를 수 있게

-- 1분마다. 같은 이름이 있으면 덮어쓴다
select cron.schedule('event-reminders', '* * * * *', 'select public.send_event_reminders()');
