-- 스레드 답글 수 (스레드 작업, 2026-09-29).
-- 답글이 달리면 부모 메시지의 reply_count·last_reply_at 을 트리거가 올린다.
-- 부모 행이 바뀌므로 실시간 UPDATE 이벤트가 채널 멤버에게 가고, 화면의 "답글 N개"가 새로고침 없이 늘어난다.
-- 답글을 따로 세지 않아도 되므로 채널 목록 조회가 가볍다.

alter table public.messages add column reply_count integer not null default 0;
alter table public.messages add column last_reply_at timestamptz;

create function public.messages_count_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.messages
  set reply_count = reply_count + 1, last_reply_at = new.created_at
  where id = new.parent_id;
  return null;
end;
$$;
create trigger messages_count_reply
  after insert on public.messages
  for each row when (new.parent_id is not null)
  execute function public.messages_count_reply();
revoke execute on function public.messages_count_reply() from public, anon, authenticated;

-- 이미 달린 답글 (검사 스크립트가 만든 것 등)
update public.messages p
set reply_count = r.n, last_reply_at = r.last_at
from (
  select parent_id, count(*)::integer as n, max(created_at) as last_at
  from public.messages where parent_id is not null group by parent_id
) r
where p.id = r.parent_id;
