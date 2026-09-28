"use client";

import { useEffect, useState } from "react";
import ChatRoom from "@/components/ChatRoom";
import NicknameForm from "@/components/NicknameForm";

const NICKNAME_KEY = "office-chat:nickname";

export default function Home() {
  const [nickname, setNickname] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setNickname(localStorage.getItem(NICKNAME_KEY));
    } catch {
      // 저장소를 못 쓰는 환경이면 매번 입력받는다
    }
    setReady(true);
  }, []);

  function enter(name: string) {
    try {
      localStorage.setItem(NICKNAME_KEY, name);
    } catch {}
    setNickname(name);
  }

  function leave() {
    try {
      localStorage.removeItem(NICKNAME_KEY);
    } catch {}
    setNickname(null);
  }

  if (!ready) return null;
  return nickname ? (
    <ChatRoom nickname={nickname} onLeave={leave} />
  ) : (
    <NicknameForm onSubmit={enter} />
  );
}
