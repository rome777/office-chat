"use client";

// ② 내가 가입한 채널 목록 + "채널 만들기"·"채널 찾기". 왼쪽 칸과 헤더의 채널 전환(좁은 화면)이 함께 쓴다.

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import type { ChannelSummary } from "@/lib/types/channel";
import BrowseChannelsDialog from "./BrowseChannelsDialog";
import CreateChannelDialog from "./CreateChannelDialog";
import { GENERAL_ID } from "./channelSource";
import { useMyChannels } from "./useChannels";
import s from "./sidebar.module.css";

export default function ChannelList({
  onPicked,
  guardCurrent = false,
}: {
  onPicked?: () => void;
  /** 보고 있는 채널에서 빠지면(관리자가 제거, 채널 삭제) #일반으로 돌아간다. 한 곳(왼쪽 칸)에서만 켠다 */
  guardCurrent?: boolean;
}) {
  const { channel, setChannel } = useWorkspace();
  const { channels, error } = useMyChannels();
  const [dialog, setDialog] = useState<"create" | "browse" | null>(null);
  const current = useRef(channel);
  current.current = channel;

  // 목록을 새로 받았을 때만 확인한다 (채널을 바꿀 때마다 확인하면, 방금 만든 채널이
  // 목록에 들어오기 전에 #일반으로 튕길 수 있다). DM 은 이 목록에 없으므로 건드리지 않는다
  useEffect(() => {
    if (!guardCurrent || !channels) return;
    const cur = current.current;
    // type 이 없는 채널(다른 영역이 id·이름만 넘긴 경우)은 무엇인지 모르므로 건드리지 않는다
    if (!cur.type || cur.type === "dm" || channels.some((c) => c.id === cur.id)) return;
    const general = channels.find((c) => c.id === GENERAL_ID);
    setChannel({ id: GENERAL_ID, name: general?.name ?? "일반", type: "public" });
  }, [channels, guardCurrent, setChannel]);

  function open(c: ChannelSummary) {
    setChannel({ id: c.id, name: c.name, type: c.type });
    setDialog(null);
    onPicked?.();
  }

  return (
    <>
      <ul className={s.list}>
        {error && <li className={s.error}>채널 목록을 못 불러왔습니다: {error}</li>}
        {channels === null && !error && <li className={s.muted}>불러오는 중…</li>}
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
