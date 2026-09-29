-- 읽음 표시 함수 (2026-09-29).
-- supabase-js 의 upsert 는 충돌 시 보낸 컬럼을 모두 SET 한다 (channel_id 포함). read_positions 는 channel_id 수정 권한이
-- 없어서 upsert 가 42501 로 거부된다. 채널을 바꾸는 권한을 여는 대신 이 함수로 쓴다.
-- 호출한 사람의 권한으로 돈다 (security invoker) → 멤버가 아니면 read_positions 정책이 막는다.

create function public.mark_read(p_channel_id uuid, p_message_id bigint) returns bigint
language sql security invoker set search_path = '' as $$
  insert into public.read_positions (channel_id, last_read_message_id)
  values (p_channel_id, p_message_id)
  on conflict (channel_id, user_id) do update
    set last_read_message_id = excluded.last_read_message_id  -- 뒤로 가는 값은 read_positions_forward 트리거가 막는다
  returning last_read_message_id;
$$;

revoke execute on function public.mark_read(uuid, bigint) from public, anon;
grant execute on function public.mark_read(uuid, bigint) to authenticated;
