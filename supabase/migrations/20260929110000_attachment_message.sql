-- 첨부 메시지 저장 (파일 첨부 작업, 2026-09-29).
-- 서버 API(/api/attachments/confirm)가 파일 시그니처를 확인한 뒤 부른다. service role 만 부를 수 있다.
-- 메시지와 첨부 행을 한 트랜잭션으로 넣는다. 따로 넣으면 실시간으로 메시지를 먼저 받은 화면이 첨부 없는 메시지를 그린다.
-- 같은 client_id 로 다시 불러도 메시지·첨부가 한 번만 생긴다 (재전송).

create function public.post_attachment_message(
  p_user_id uuid,
  p_channel_id uuid,
  p_client_id uuid,
  p_body text,
  p_storage_path text,
  p_mime text,
  p_size integer,
  p_file_name text
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  msg bigint;
begin
  -- 서버가 이미 확인했지만, 이 함수만 불러도 멤버가 아닌 채널에는 못 넣게 한 번 더 막는다
  if not exists (
    select 1 from public.memberships where channel_id = p_channel_id and user_id = p_user_id
  ) then
    raise exception '채널 멤버가 아닙니다' using errcode = '42501';
  end if;

  insert into public.messages (client_id, channel_id, user_id, body)
  values (p_client_id, p_channel_id, p_user_id, coalesce(btrim(p_body), ''))
  on conflict (client_id) do nothing
  returning id into msg;
  if msg is null then
    select id into msg from public.messages
    where client_id = p_client_id and user_id = p_user_id and channel_id = p_channel_id;
    if msg is null then
      raise exception '이미 다른 메시지에 쓴 client_id 입니다' using errcode = '23505';
    end if;
  end if;

  insert into public.attachments (message_id, channel_id, storage_path, mime, size, file_name)
  values (msg, p_channel_id, p_storage_path, p_mime, p_size, p_file_name)
  on conflict (storage_path) do nothing;
  return msg;
end;
$$;

revoke execute on function public.post_attachment_message(uuid, uuid, uuid, text, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.post_attachment_message(uuid, uuid, uuid, text, text, text, integer, text)
  to service_role;

-- 첨부도 실시간으로 받는다 (RLS: 그 채널 멤버만). 화면은 message_id 로 메시지에 붙인다
alter publication supabase_realtime add table public.attachments;
