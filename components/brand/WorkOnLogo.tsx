// WorkOn 로고 (2026-09-30) — 사용자가 준 로고 파일의 모양(logoPaths.ts)을 그대로 그린다.
// 라이트는 기본 로고(workon_logo.svg), 다크는 흰색 로고(workon_logo_white.svg)와 같은 색이 되도록
// globals.css 의 --logo-ink(글자·W)·--logo-accent(파란 삼각형)로 칠한다. 이미지 두 장을 바꿔 끼우지 않아서
// 사용자가 고른 테마(쿠키)와 컴퓨터 설정 어느 쪽이든 새로고침 때 깜빡이지 않는다.
import { LOGO_ACCENT, LOGO_INK, LOGO_VIEWBOX } from "./logoPaths";

const [, , VB_W, VB_H] = LOGO_VIEWBOX.split(" ").map(Number);

type Props = {
  /** 그릴 높이(px). 폭은 비율대로 따라간다 */
  height?: number;
  className?: string;
};

export default function WorkOnLogo({ height = 24, className }: Props) {
  return (
    <svg
      className={className}
      viewBox={LOGO_VIEWBOX}
      height={height}
      width={Math.round((height * VB_W) / VB_H)}
      role="img"
      aria-label="WorkOn"
      style={{ display: "block", flex: "none" }}
    >
      <path d={LOGO_INK} fillRule="evenodd" style={{ fill: "var(--logo-ink)" }} />
      <path d={LOGO_ACCENT} fillRule="evenodd" style={{ fill: "var(--logo-accent)" }} />
    </svg>
  );
}
