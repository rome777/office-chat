-- 내 프로필 (2026-09-30, ② 김송이, WU-33)
-- 1) 이름·부서·직급·아이디는 인사 정보라 본인이 못 고친다 (WU-31 팀 상의: 사칭·옛 멘션 끊기 방지). 서버·시드만 바꾼다
-- 2) 본인이 고치는 것: 프로필 사진(캐릭터·사진), 상태(온라인·자리 비움·방해 금지·오프라인으로 표시), 상태 메시지
-- 3) 연락처는 공개·비공개가 있어 profiles 와 따로 둔다 (profiles 는 로그인한 누구나 모든 행을 읽으므로 칸 권한으로는 줄마다 못 숨긴다)
-- 4) 프로필 사진 버킷: 공개 읽기, 쓰기는 본인 폴더(<내 id>/...)만

-- ─── 기본 정보 잠금 ─────────────────────────────────
revoke update (handle, display_name, department, title) on public.profiles from authenticated;

-- ─── 사진·상태 ─────────────────────────────────────
-- avatar: null = 이름 첫 글자, 'char:<캐릭터 id>' = 캐릭터, 'photo:<내 id>/<파일>' = 올린 사진 (avatars 버킷 안 경로)
-- status 'invisible' = 접속해 있지만 남에게 오프라인으로 보이기. 남에게 보여 줄 때는 'offline' 과 똑같이 그린다
alter table public.profiles
  add column avatar         text,
  add column status         text not null default 'online',
  add column status_message text not null default '',
  add constraint profiles_avatar_format check (
    avatar is null
    or avatar ~ '^char:[a-z0-9-]{1,30}$'
    or avatar ~ ('^photo:' || id::text || '/[A-Za-z0-9_-]{1,64}\.(webp|jpg|png)$')
  ),
  add constraint profiles_status check (status in ('online', 'away', 'dnd', 'invisible')),
  add constraint profiles_status_message_len check (char_length(status_message) <= 60);

grant update (avatar, status, status_message) on public.profiles to authenticated;
-- 수정 정책은 그대로 "본인만 수정" (20260929100000_db_v1.sql)

-- ─── 연락처 ────────────────────────────────────────
-- 읽기: 본인, 공개한 사람의 것, 관리자(급할 때 연락). 쓰기: 본인 행만
create table public.profile_contacts (
  user_id    uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  phone      text not null default '',
  is_public  boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint profile_contacts_phone check (phone ~ '^[0-9+() -]{0,20}$')
);

alter table public.profile_contacts enable row level security;
revoke all on public.profile_contacts from anon, authenticated;
grant select on public.profile_contacts to authenticated;
grant insert (phone, is_public) on public.profile_contacts to authenticated;
grant update (phone, is_public) on public.profile_contacts to authenticated;

create policy "본인·공개·관리자 조회" on public.profile_contacts
  for select to authenticated using (
    user_id = (select auth.uid()) or is_public or public.is_admin()
  );
create policy "본인만 추가" on public.profile_contacts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "본인만 수정" on public.profile_contacts
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function public.profile_contacts_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger profile_contacts_touch
  before update on public.profile_contacts
  for each row execute function public.profile_contacts_touch();

-- ─── 프로필 사진 버킷 ──────────────────────────────
-- 화면은 브라우저에서 256px 정사각형으로 잘라 다시 그린 WEBP·JPEG 를 올린다. 버킷에서도 크기·형식을 막는다
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "프로필 사진: 본인 폴더 조회" on storage.objects
  for select to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "프로필 사진: 본인 폴더에 올리기" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "프로필 사진: 본인 폴더 지우기" on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
