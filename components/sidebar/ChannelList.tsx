"use client";

// ② 내가 가입한 채널 목록 + "채널 만들기"·"채널 찾기". 왼쪽 칸과 헤더의 채널 전환(좁은 화면)이 함께 쓴다.

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import type { ChannelSummary } from "@/lib/types/channel";
import BrowseChannelsDialog from "./BrowseChannelsDialog";
import CreateChannelDialog from "./CreateChannelDialog";
import { GENERAL_ID } from "./channelSource";
import { LockIcon, PlusIcon, SearchIcon } from "./ActionIcons";
import ChannelRowButton from "./ChannelRowButton";
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
    // #일반 은 목록에서 숨기므로(2026-09-30) 보이는 첫 채널로 간다. 하나도 없을 때만 #일반
    const next = channels.find((c) => c.id !== GENERAL_ID) ?? channels.find((c) => c.id === GENERAL_ID);
    setChannel(next ? { id: next.id, name: next.name, type: next.type } : { id: GENERAL_ID, name: "일반", type: "public" });
  }, [channels, guardCurrent, setChannel]);

  // 다른 영역이 id·이름만 넘겨 채널을 바꾸면(예: ① 의 메시지로 이동) 종류를 채운다 — 비공개면 헤더에 자물쇠
  useEffect(() => {
    if (!guardCurrent || !channels || channel.type) return;
    const found = channels.find((c) => c.id === channel.id);
    if (found) setChannel({ id: found.id, name: found.name, type: found.type });
  }, [channel, channels, guardCurrent, setChannel]);

  function open(c: ChannelSummary) {
    setChannel({ id: c.id, name: c.name, type: c.type });
    setDialog(null);
    onPicked?.();
  }

  return (
    <>
      <ul className={s.list}>
        {error && <li className={`${s.item} ${s.error}`}>채널 목록을 못 불러왔습니다: {error}</li>}
        {channels === null && !error && <li className={`${s.item} ${s.muted}`}>불러오는 중…</li>}
        {/* #일반 은 목록에서만 숨긴다 (2026-09-30 결정). 채널·멤버십은 그대로라 알림·검색으로는 열린다 */}
        {channels?.filter((c) => c.id !== GENERAL_ID).map((c) => {
          const active = c.id === channel.id;
          return (
            <li key={c.id}>
              <ChannelRowButton
                channelId={c.id}
                label={c.type === "private" ? `${c.name} (비공개)` : c.name}
                active={active}
                onClick={() => open(c)}
              >
                <span aria-hidden="true">#</span>
                <span className={s.channelName}>{c.name}</span>
                {c.type === "private" && (
                  <span className={s.lock}>
                    <LockIcon />
                  </span>
                )}
              </ChannelRowButton>
            </li>
          );
        })}
      </ul>
      <div className={s.channelActions}>
        <button type="button" className={`${s.textButton} ${s.iconText}`} onClick={() => setDialog("create")}>
          <PlusIcon />
          채널 만들기
        </button>
        <button type="button" className={`${s.textButton} ${s.iconText}`} onClick={() => setDialog("browse")}>
          <SearchIcon />
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
