-- 회의실 8개의 층·시설·설명 (2026-10-01, WU-46 — 20261001170000_rooms_v2 바로 뒤).
-- 원격(팀·운영 공용) DB 의 회의실은 시드의 "회의실 1 (소)" 3개가 아니라 이미 C1 상생 ~ M4 연구 8개였고,
-- 층·장비·용도가 location 한 칸에 글자로 들어 있었다 ("5층 대회의실 · 빔프로젝터·무선 마이크 2개·화상회의 · 타운홀·행사").
-- 그래서 20261001170000 의 회의실 부분(이름으로 시설 채우기 3개 + 새 회의실 5개)은 원격에서 맞지 않았다:
--   채울 이름이 없었고, 새 5개는 원격에 들어갔다가 예약 0건인 것을 확인하고 바로 지웠다 (2026-10-01).
-- 이 파일은 그 정리를 다른 DB 에도 똑같이 하고(예약 없는 새 5개만 지운다), 8개를 층(location) · 시설(facilities) · 설명(description)으로 나눈다.
-- 회의실 필터(층)·카드의 시설 아이콘이 이 칸을 쓴다. 장비 개수·크기 같은 자세한 것은 설명에 남긴다.

delete from public.rooms r
where r.name in ('포커스룸', '회의실 4 (소)', '회의실 5 (중)', '회의실 6 (중)', '세미나실')
  and not exists (select 1 from public.events e where e.room_id = r.id);

update public.rooms set location = '5층', facilities = '{projector,video,mic}', sort_order = 10,
  description = '대회의실 · 무선 마이크 2개 · 타운홀·행사' where name = 'C1 상생';
update public.rooms set location = '5층', facilities = '{monitor,video}', sort_order = 20,
  description = '보안 회의 · 임원·고객 미팅 우선' where name = 'C2 신뢰';
update public.rooms set location = '3층', facilities = '{projector}', sort_order = 30,
  description = '교육실 · 노트북 대여 6대 · 교육·온보딩' where name = 'C3 열정';
update public.rooms set location = '6층', facilities = '{monitor,video}', sort_order = 40,
  description = '85인치 TV · 스프린트·배포 상황실' where name = 'C4 이끔';
update public.rooms set location = '5층', facilities = '{video,mic,whiteboard}', sort_order = 50,
  description = '화상회의 카메라·스피커폰' where name = 'M1 확산';
update public.rooms set location = '5층', facilities = '{monitor}', sort_order = 60,
  description = 'C1 옆 · 55인치 TV·화면 공유' where name = 'M2 공유';
update public.rooms set location = '6층', facilities = '{monitor,whiteboard}', sort_order = 70,
  description = '소회의실 · 면접 가능' where name = 'M3 가치';
update public.rooms set location = '6층', facilities = '{video}', sort_order = 80,
  description = '2인 화상회의 부스 · 방음 · 1:1 면담' where name = 'M4 연구';
