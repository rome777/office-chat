// ② 왼쪽 칸 글자 버튼("채널 만들기"·"채널 찾기"·"새 메시지") 앞의 아이콘과, 비공개 채널 이름 뒤의 자물쇠.
// 헤더의 해·달(ThemeToggle)·입력창 아이콘과 같은 규칙: 24칸, 둥근 끝, 색은 글자색을 따른다. 글자 옆이라 작게, 선은 조금 굵게.

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </svg>
  );
}

/** 비공개 채널 표시. 채널 이름 뒤에 붙인다 (이름은 "#" 으로 시작하고, 자물쇠가 비공개임을 알린다) */
export function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}
