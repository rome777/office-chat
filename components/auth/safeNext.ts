// ② 로그인 뒤 돌아갈 주소. 우리 사이트 안의 경로만 허용한다 ("//다른사이트" 로 빠져나가지 못하게).
// 브라우저는 주소에서 탭·줄바꿈을 지우므로("/\t/evil.com" → "//evil.com") 글자 검사만으로는 부족하다.
// 실제로 주소를 풀어 본 뒤 출처가 그대로인지 확인한다.
export function safeNext(next: string | string[] | null | undefined): string {
  const raw = Array.isArray(next) ? next[0] : next;
  if (!raw || !raw.startsWith("/") || /[\x00-\x1f\\]/.test(raw)) return "/";
  const base = "http://same.origin";
  try {
    const url = new URL(raw, base);
    if (url.origin !== base) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
