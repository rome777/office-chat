// ② 회의실 카드 사진 (public/rooms/, 800x480 webp). 이름으로 찾고, 없으면 카드가 배치 그림(Plan)을 그린다.
// 사진은 각 회의실의 인원·시설에 맞춘 이미지다 (2026-10-01 사용자 제공). 회의실 이름을 바꾸면 여기도 바꾼다.

const PHOTOS: Record<string, string> = {
  "C1 상생": "/rooms/c1.webp",
  "C2 신뢰": "/rooms/c2.webp",
  "C3 열정": "/rooms/c3.webp",
  "C4 이끔": "/rooms/c4.webp",
  "M1 확산": "/rooms/m1.webp",
  "M2 공유": "/rooms/m2.webp",
  "M3 가치": "/rooms/m3.webp",
  "M4 연구": "/rooms/m4.webp",
};

export const roomPhoto = (name: string): string | null => PHOTOS[name] ?? null;
