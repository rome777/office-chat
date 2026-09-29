-- 회의 불참 알림 (2026-09-29, 김송이 — 테스트 메모 반영, 알림 틀은 ③ 20260929140000_event_notifications.sql 과 같다)
--   event_decline   event_attendees UPDATE (response → declined)   회의를 만든 사람 (불참한 사람이 만든 사람이면 없음)
-- 누가 불참했는지는 새 칸 actor_id 에 적는다 (알림에는 본문이 없어서, 이름은 화면이 profiles 에서 읽는다).
-- 다시 참석(또는 응답 전)으로 바꾸면, 만든 사람이 아직 안 읽은 그 사람의 불참 알림을 지운다. 읽은 알림은 남긴다.
-- 불참 → 참석 → 불참이면 안 읽은 알림은 마지막 하나만 남는다. 취소된 회의는 알리지 않는다.

alter table public.notifications add column actor_id uuid references public.profiles (id) on delete set null;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'dm', 'mention', 'thread_reply',
  'event_invite', 'event_update', 'event_cancel', 'event_reminder', 'event_decline'));

create function public.event_attendees_notify_decline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  organizer uuid;
begin
  if new.response is not distinct from old.response then
    return null;
  end if;
  select e.created_by into organizer
  from public.events e
  where e.id = new.event_id and e.canceled_at is null;
  if organizer is null or organizer = new.user_id then
    return null; -- 취소된 회의, 만든 사람이 없어진 회의, 만든 사람 자신
  end if;

  delete from public.notifications
  where user_id = organizer and event_id = new.event_id and type = 'event_decline'
    and actor_id = new.user_id and read_at is null;

  if new.response = 'declined' then
    insert into public.notifications (user_id, type, event_id, actor_id)
    values (organizer, 'event_decline', new.event_id, new.user_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.event_attendees_notify_decline() from public, anon, authenticated;
create trigger event_attendees_notify_decline
  after update of response on public.event_attendees
  for each row execute function public.event_attendees_notify_decline();
