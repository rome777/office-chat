"use client";

// ② 입장 화면. 로그인 작업에서 로그인 화면으로 바뀐다.

import { useState } from "react";
import s from "./auth.module.css";

export default function NicknameForm({ onSubmit }: { onSubmit: (nickname: string) => void }) {
  const [value, setValue] = useState("");
  const name = value.trim();
  const valid = name.length > 0 && name.length <= 20;

  return (
    <main className={s.entry}>
      <form
        className={s.card}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(name);
        }}
      >
        <h1>오피스톡</h1>
        <p className="muted">닉네임을 정하고 #일반 채널에 들어갑니다.</p>
        <input
          autoFocus
          placeholder="닉네임 (1~20자)"
          maxLength={20}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" disabled={!valid}>
          입장
        </button>
      </form>
    </main>
  );
}
