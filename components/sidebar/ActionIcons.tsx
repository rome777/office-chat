// ② 왼쪽 칸 글자 버튼("채널 만들기"·"채널 찾기"·"새 메시지") 앞의 아이콘.
// 헤더의 해·달(ThemeToggle)·입력창 아이콘과 같은 규칙: 24칸, 둥근 끝, 색은 글자색을 따른다. 글자 옆이라 14px 로 작게, 선은 조금 굵게.

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
