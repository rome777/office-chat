// ② 프로필 캐릭터. 그림 파일 없이 SVG 로 그린다 (64×64). DB 에는 "char:<id>" 로 남는다.
// id 는 DB 제약(profiles_avatar_format: 영문 소문자·숫자·-)에 맞춘다. 한 번 쓴 id 는 바꾸지 않는다 (이미 고른 사람이 있다).

import type { ReactNode } from "react";

const INK = "#2f2a28";
const CHEEK = "#f4a6a6";

const eyes = (y = 34, dx = 8, r = 2.6) => (
  <>
    <circle cx={32 - dx} cy={y} r={r} fill={INK} />
    <circle cx={32 + dx} cy={y} r={r} fill={INK} />
  </>
);
const cheeks = (y = 40, dx = 12) => (
  <>
    <circle cx={32 - dx} cy={y} r={2.6} fill={CHEEK} opacity={0.7} />
    <circle cx={32 + dx} cy={y} r={2.6} fill={CHEEK} opacity={0.7} />
  </>
);
const smile = (y = 44) => <path d={`M28.5 ${y} q3.5 3 7 0`} stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" />;

type Character = { id: string; name: string; bg: string; art: ReactNode };

export const CHARACTERS: readonly Character[] = [
  {
    id: "bear",
    name: "곰",
    bg: "#f3e3d3",
    art: (
      <>
        <circle cx={18} cy={21} r={7} fill="#a0714f" />
        <circle cx={46} cy={21} r={7} fill="#a0714f" />
        <circle cx={18} cy={21} r={3.5} fill="#d9b08c" />
        <circle cx={46} cy={21} r={3.5} fill="#d9b08c" />
        <circle cx={32} cy={37} r={18} fill="#a0714f" />
        <ellipse cx={32} cy={43} rx={8.5} ry={6.5} fill="#e8cfb4" />
        <ellipse cx={32} cy={40.5} rx={3} ry={2.2} fill={INK} />
        {eyes(33)}
      </>
    ),
  },
  {
    id: "cat",
    name: "고양이",
    bg: "#fde8d4",
    art: (
      <>
        <path d="M15 30 L17 12 L29 22 Z M49 30 L47 12 L35 22 Z" fill="#f4a259" />
        <path d="M18 24 L19 16 L25 21 Z M46 24 L45 16 L39 21 Z" fill="#f9d0a6" />
        <circle cx={32} cy={37} r={18} fill="#f4a259" />
        <path d="M32 19 v6 M26 20 l1.5 5 M38 20 l-1.5 5" stroke="#d9823a" strokeWidth={2} strokeLinecap="round" />
        {eyes(35)}
        <path d="M30 40 h4 l-2 2.4 Z" fill="#e0707a" />
        <path d="M14 40 h8 M14 44 l8 -2 M50 40 h-8 M50 44 l-8 -2" stroke={INK} strokeWidth={1} strokeLinecap="round" opacity={0.6} />
      </>
    ),
  },
  {
    id: "dog",
    name: "강아지",
    bg: "#eee3d3",
    art: (
      <>
        <circle cx={32} cy={36} r={18} fill="#e6c9a0" />
        <ellipse cx={15} cy={33} rx={6} ry={12} fill="#8a5a3b" transform="rotate(15 15 33)" />
        <ellipse cx={49} cy={33} rx={6} ry={12} fill="#8a5a3b" transform="rotate(-15 49 33)" />
        <ellipse cx={39} cy={31} rx={5} ry={4.5} fill="#c9a377" />
        {eyes(33, 7)}
        <ellipse cx={32} cy={41} rx={3.4} ry={2.5} fill={INK} />
        {smile(45)}
      </>
    ),
  },
  {
    id: "rabbit",
    name: "토끼",
    bg: "#fbe4ec",
    art: (
      <>
        <ellipse cx={24} cy={15} rx={5} ry={13} fill="#ffffff" />
        <ellipse cx={40} cy={15} rx={5} ry={13} fill="#ffffff" />
        <ellipse cx={24} cy={15} rx={2.4} ry={9} fill="#f6b7c8" />
        <ellipse cx={40} cy={15} rx={2.4} ry={9} fill="#f6b7c8" />
        <circle cx={32} cy={38} r={17} fill="#ffffff" />
        {eyes(36, 7)}
        {cheeks(41, 11)}
        <path d="M30 41 h4 l-2 2.2 Z" fill="#e88aa2" />
        <path d="M32 43.2 v2 M32 45.2 q-2 1.6 -3.5 0 M32 45.2 q2 1.6 3.5 0" stroke={INK} strokeWidth={1.2} fill="none" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "panda",
    name: "판다",
    bg: "#e3eee6",
    art: (
      <>
        <circle cx={18} cy={21} r={6.5} fill={INK} />
        <circle cx={46} cy={21} r={6.5} fill={INK} />
        <circle cx={32} cy={37} r={18} fill="#ffffff" />
        <ellipse cx={24} cy={35} rx={4.5} ry={5.5} fill={INK} transform="rotate(25 24 35)" />
        <ellipse cx={40} cy={35} rx={4.5} ry={5.5} fill={INK} transform="rotate(-25 40 35)" />
        <circle cx={24.5} cy={34.5} r={1.6} fill="#ffffff" />
        <circle cx={39.5} cy={34.5} r={1.6} fill="#ffffff" />
        <ellipse cx={32} cy={42} rx={2.8} ry={2} fill={INK} />
        {smile(45.5)}
      </>
    ),
  },
  {
    id: "fox",
    name: "여우",
    bg: "#fde6d8",
    art: (
      <>
        <path d="M14 32 L16 11 L30 22 Z M50 32 L48 11 L34 22 Z" fill="#e8743b" />
        <path d="M17 25 L18 16 L25 21 Z M47 25 L46 16 L39 21 Z" fill="#3b2a24" />
        <circle cx={32} cy={37} r={18} fill="#e8743b" />
        <path d="M14.5 40 Q24 36 32 46 Q40 36 49.5 40 Q46 54 32 55 Q18 54 14.5 40 Z" fill="#fff4ea" />
        {eyes(34)}
        <ellipse cx={32} cy={45} rx={2.8} ry={2} fill={INK} />
      </>
    ),
  },
  {
    id: "penguin",
    name: "펭귄",
    bg: "#dde8f5",
    art: (
      <>
        <circle cx={32} cy={35} r={20} fill="#2f3a4a" />
        <path d="M32 26 Q20 20 17 34 Q16 50 32 52 Q48 50 47 34 Q44 20 32 26 Z" fill="#ffffff" />
        {eyes(35, 7)}
        {cheeks(41, 11)}
        <path d="M28 40 L36 40 L32 45 Z" fill="#f5a524" />
      </>
    ),
  },
  {
    id: "chick",
    name: "병아리",
    bg: "#fdf3cc",
    art: (
      <>
        <path d="M30 18 q-2 -6 2 -8 M33 18 q3 -5 6 -4" stroke="#e6b400" strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <circle cx={32} cy={37} r={19} fill="#ffd23f" />
        {eyes(34)}
        {cheeks(40)}
        <path d="M27.5 40 L32 37.5 L36.5 40 L32 43.5 Z" fill="#f28c28" />
      </>
    ),
  },
  {
    id: "frog",
    name: "개구리",
    bg: "#e2f2dc",
    art: (
      <>
        <circle cx={21} cy={24} r={8} fill="#7cc36b" />
        <circle cx={43} cy={24} r={8} fill="#7cc36b" />
        <ellipse cx={32} cy={39} rx={21} ry={15} fill="#7cc36b" />
        <circle cx={21} cy={24} r={4.5} fill="#ffffff" />
        <circle cx={43} cy={24} r={4.5} fill="#ffffff" />
        <circle cx={21.5} cy={24.5} r={2.3} fill={INK} />
        <circle cx={42.5} cy={24.5} r={2.3} fill={INK} />
        {cheeks(41, 13)}
        <path d="M22 42 q10 8 20 0" stroke={INK} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "koala",
    name: "코알라",
    bg: "#e6e9ee",
    art: (
      <>
        <circle cx={15} cy={27} r={10} fill="#9aa3ae" />
        <circle cx={49} cy={27} r={10} fill="#9aa3ae" />
        <circle cx={15} cy={27} r={5.5} fill="#e9d3dc" />
        <circle cx={49} cy={27} r={5.5} fill="#e9d3dc" />
        <circle cx={32} cy={37} r={17} fill="#9aa3ae" />
        {eyes(33, 7.5, 2.3)}
        <ellipse cx={32} cy={40} rx={4.5} ry={6} fill="#3d3f46" />
      </>
    ),
  },
  {
    id: "pig",
    name: "돼지",
    bg: "#fde2e4",
    art: (
      <>
        <path d="M15 26 L18 13 L28 21 Z M49 26 L46 13 L36 21 Z" fill="#f09aaa" />
        <circle cx={32} cy={37} r={18} fill="#f7b9c3" />
        {eyes(32)}
        <ellipse cx={32} cy={41} rx={7} ry={5} fill="#ef8f9f" />
        <ellipse cx={29.5} cy={41} rx={1.3} ry={1.8} fill="#b8566a" />
        <ellipse cx={34.5} cy={41} rx={1.3} ry={1.8} fill="#b8566a" />
      </>
    ),
  },
  {
    id: "robot",
    name: "로봇",
    bg: "#e4e7f5",
    art: (
      <>
        <path d="M32 13 v7" stroke="#6f7aa6" strokeWidth={2} />
        <circle cx={32} cy={12} r={3} fill="#f06a6a" />
        <rect x={13} y={20} width={38} height={32} rx={9} fill="#aab4d4" />
        <rect x={9} y={31} width={4} height={10} rx={2} fill="#6f7aa6" />
        <rect x={51} y={31} width={4} height={10} rx={2} fill="#6f7aa6" />
        <rect x={18} y={27} width={28} height={14} rx={6} fill="#2f3550" />
        <circle cx={25} cy={34} r={2.8} fill="#7df0d0" />
        <circle cx={39} cy={34} r={2.8} fill="#7df0d0" />
        <path d="M26 46 h12" stroke="#6f7aa6" strokeWidth={2} strokeLinecap="round" />
      </>
    ),
  },
];

const BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

export function findCharacter(id: string) {
  return BY_ID.get(id) ?? null;
}

export function CharacterArt({ id, size }: { id: string; size: number }) {
  const c = BY_ID.get(id);
  if (!c) return null;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <circle cx={32} cy={32} r={32} fill={c.bg} />
      {c.art}
    </svg>
  );
}
