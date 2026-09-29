"use client";

// ② 헤더의 검색창. 검색 작업에서 결과 목록과 "메시지로 이동(?m=)"을 붙인다.

import s from "./search.module.css";

export default function SearchBox() {
  return (
    <input
      className={s.box}
      type="search"
      placeholder="검색 (준비 중)"
      aria-label="메시지 검색"
      disabled
    />
  );
}
