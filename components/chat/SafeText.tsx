// ① 안전한 출력. 사용자 입력과 AI 결과는 모두 이것으로 그린다 (③ 의 AI 패널도 가져다 쓴다).
// React 기본 텍스트 출력만 쓰므로 HTML·스크립트가 실행되지 않는다. 문자열을 HTML 로 넣는 방식은 쓰지 않는다.
// 링크는 http·https 로 시작하는 것만 바꾼다 (TECH_SPEC 7절). `javascript:` 같은 주소는 글자 그대로 남는다.

import { Fragment, type ReactNode } from "react";
import s from "./chat.module.css";

// 1: 주소, 2: 멘션. 멘션은 앞이 글자가 아닐 때만 인정한다 (a@b.com 같은 메일 주소는 멘션이 아니다)
const TOKEN = /(https?:\/\/[^\s<>"'`]+)|((?<![\p{L}\p{N}_])@[\p{L}\p{N}_-]+)/gu;
// 문장 끝의 문장부호는 주소에 넣지 않는다 ("https://a.com." → 주소는 https://a.com)
const TRAILING = /[.,!?;:)\]}>'"]+$/;

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export default function SafeText({
  text,
  mentions,
}: {
  text: string;
  /** 주면 `@이름` 을 강조한다. `me` 와 같으면 나를 부른 것으로 더 눈에 띄게 한다 */
  mentions?: { me?: string };
}) {
  const out: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(TOKEN)) {
    const [whole, url, mention] = match;
    const start = match.index;

    if (url) {
      const trimmed = url.replace(TRAILING, "");
      const href = safeHref(trimmed);
      if (!href) continue; // 글자 그대로 남긴다
      out.push(text.slice(last, start));
      out.push(
        <a key={start} href={href} target="_blank" rel="noopener noreferrer">
          {trimmed}
        </a>,
      );
      last = start + trimmed.length;
    } else if (mention && mentions) {
      // 채널 멤버인지는 아직 모른다. 멤버 목록이 생기면(DB v1) 멤버만 강조한다
      const name = mention.slice(1);
      out.push(text.slice(last, start));
      out.push(
        <span key={start} className={`${s.mention} ${name === mentions.me ? s.mentionMe : ""}`}>
          {whole}
        </span>,
      );
      last = start + whole.length;
    }
  }

  if (out.length === 0) return <>{text}</>;
  out.push(text.slice(last));
  return (
    <>
      {out.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}
