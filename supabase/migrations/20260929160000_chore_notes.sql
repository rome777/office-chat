-- 잡무 수첩 (2026-09-29)
-- 커피 주문·점심 메뉴처럼 반복되는 잡무를 채널마다 적어 둔다. 목록(예: "커피")마다 장소·메모가 있고,
-- 그 아래에 사람별 기록("이부장님 — 아아 얼음 많이")이 달린다. 채널 멤버는 누구나 보고 고친다
-- — 새로 온 사람이 채널에 들어오기만 하면 인수인계 없이 바로 쓰게 하려고.
-- 사람은 이름을 글자로 적는다 (호칭 "이부장님"으로 부르고, 채팅 계정이 없는 사람도 있어서).

create table public.chore_lists (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  title      text not null check (title ~ '\S' and char_length(title) <= 40),
  place      text not null default '' check (char_length(place) <= 100),
  memo       text not null default '' check (char_length(memo) <= 1000),
  -- 만든 사람이 탈퇴해도 수첩은 남아야 한다 (인수인계용)
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chore_lists_channel_idx on public.chore_lists (channel_id, created_at);

create table public.chore_entries (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.chore_lists (id) on delete cascade,
  person_name text not null check (person_name ~ '\S' and char_length(person_name) <= 30),
  detail      text not null check (detail ~ '\S' and char_length(detail) <= 200),
  updated_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index chore_entries_list_idx on public.chore_entries (list_id, created_at);

-- 고친 사람·시각은 클라이언트가 못 보낸다 (컬럼 권한). 트리거가 채운다
create function public.chore_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), old.updated_by);
  return new;
end;
$$;
revoke execute on function public.chore_touch() from public, anon;
create trigger chore_lists_touch before update on public.chore_lists
  for each row execute function public.chore_touch();
create trigger chore_entries_touch before update on public.chore_entries
  for each row execute function public.chore_touch();

-- 기록이 바뀌면 목록의 "마지막 수정"도 바뀐다 (security definer: 기록만 고칠 수 있어도 목록 시각을 올린다)
create function public.chore_entries_touch_list() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chore_lists
  set updated_at = now(), updated_by = coalesce((select auth.uid()), updated_by)
  where id = coalesce(new.list_id, old.list_id);
  return null;
end;
$$;
revoke execute on function public.chore_entries_touch_list() from public, anon;
create trigger chore_entries_touch_list after insert or update or delete on public.chore_entries
  for each row execute function public.chore_entries_touch_list();

-- 권한: 채널 멤버가 보고 고친다. 목록 삭제는 만든 사람과 관리자만 (멤버 누구나 지우면 쌓아 둔 기록이 한 번에 사라진다)
revoke all on public.chore_lists, public.chore_entries from anon, authenticated;

grant select, delete on public.chore_lists to authenticated;
grant insert (channel_id, title, place, memo) on public.chore_lists to authenticated;
grant update (title, place, memo) on public.chore_lists to authenticated;
create policy "멤버만 조회" on public.chore_lists
  for select to authenticated using (public.is_member(channel_id));
create policy "멤버가 본인 이름으로 만들기" on public.chore_lists
  for insert to authenticated with check (created_by = (select auth.uid()) and public.is_member(channel_id));
create policy "멤버가 수정" on public.chore_lists
  for update to authenticated using (public.is_member(channel_id)) with check (public.is_member(channel_id));
create policy "만든 사람·관리자만 삭제" on public.chore_lists
  for delete to authenticated using (
    public.is_member(channel_id) and (created_by = (select auth.uid()) or public.is_admin())
  );

-- 기록은 목록을 볼 수 있는 사람(= 그 채널 멤버)이 보고 고친다. 목록 정책이 멤버를 거르므로 exists 로 충분하다
grant select, delete on public.chore_entries to authenticated;
grant insert (list_id, person_name, detail) on public.chore_entries to authenticated;
grant update (person_name, detail) on public.chore_entries to authenticated;
create policy "멤버만 조회" on public.chore_entries
  for select to authenticated using (exists (select 1 from public.chore_lists l where l.id = list_id));
create policy "멤버가 추가" on public.chore_entries
  for insert to authenticated with check (exists (select 1 from public.chore_lists l where l.id = list_id));
create policy "멤버가 수정" on public.chore_entries
  for update to authenticated
  using (exists (select 1 from public.chore_lists l where l.id = list_id))
  with check (exists (select 1 from public.chore_lists l where l.id = list_id));
create policy "멤버가 삭제" on public.chore_entries
  for delete to authenticated using (exists (select 1 from public.chore_lists l where l.id = list_id));
