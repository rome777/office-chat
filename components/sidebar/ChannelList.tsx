"use client";

// ② 내가 가입한 채널 목록 + "채널 만들기"·"채널 찾기". 왼쪽 칸과 헤더의 채널 전환(좁은 화면)이 함께 쓴다.

import { useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import type { ChannelSummary } from "@/lib/types/channel";
import BrowseChannelsDialog from "./BrowseChannelsDialog";
import CreateChannelDialog from "./CreateChannelDialog";
import { GENERAL_ID } from "./channelSource";
import { useMyChannels } from "./useChannels";
import s from "./sidebar.module.css";

export default function ChannelList({ onPicked }: { onPicked?: () => void }) {
  const { channel, setChannel } = useWorkspace();
  const channels = useMyChannels();
  const [dialog, setDialog] = useState<"create" | "browse" | null>(null);

  function open(c: ChannelSummary) {
    setChannel({ id: c.id, name: c.name, type: c.type });
    setDialog(null);
    onPicked?.();
  }

  return (
    <>
      <ul className={s.list}>
        {channels === null && <li className={s.muted}>불러오는 중…</li>}
        {channels?.map((c) => {
          const active = c.id === channel.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`${s.item} ${s.channelButton} ${active ? s.active : ""}`}
                aria-current={active ? "page" : undefined}
                aria-label={c.type === "private" ? `${c.name} (비공개)` : c.name}
                onClick={() => open(c)}
              >
                <span aria-hidden="true">{c.type === "private" ? "🔒" : "#"}</span>
                <span className={s.channelName}>{c.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className={s.channelActions}>
        <button type="button" className={s.textButton} onClick={() => setDialog("create")}>
          + 채널 만들기
        </button>
        <button type="button" className={s.textButton} onClick={() => setDialog("browse")}>
          채널 찾기
        </button>
      </div>
      {channel.id !== GENERAL_ID && (
        <p className={s.note}>
          DB 연결 전이라 메시지는 모든 채널에서 #일반과 같이 보이고 저장됩니다.
        </p>
      )}

      {dialog === "create" && (
        <CreateChannelDialog onClose={() => setDialog(null)} onCreated={open} />
      )}
      {dialog === "browse" && (
        <BrowseChannelsDialog
          onClose={() => setDialog(null)}
          onOpen={open}
          onCreate={() => setDialog("create")}
        />
      )}
    </>
  );
}
