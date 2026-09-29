"use client";

// ② 헤더 왼쪽의 채널 이름

import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import s from "./sidebar.module.css";

export default function ChannelTitle() {
  const { channel } = useWorkspace();
  return <h1 className={s.title}># {channel.name}</h1>;
}
