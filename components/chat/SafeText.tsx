// ① 안전한 출력. 사용자 입력과 AI 결과는 모두 이것으로 그린다 (③ 의 AI 패널도 가져다 쓴다).
// React 기본 텍스트 출력만 쓰므로 HTML·스크립트가 실행되지 않는다. 문자열을 HTML 로 넣는 방식은 쓰지 않는다.
// 링크 바꾸기(http·https 만)는 "안전한 출력" 작업에서 여기에 넣는다 (TECH_SPEC 7절).

export default function SafeText({ text }: { text: string }) {
  return <>{text}</>;
}
