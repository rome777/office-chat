"use client";

// ② 다이렉트 메시지 목록 + "새 메시지". 왼쪽 칸과 헤더의 채널 전환(좁은 화면)이 함께 쓴다.

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { GENERAL_ID } from "./channelSource";
import NewDmDialog from "./NewDmDialog";
import { PlusIcon } from "./ActionIcons";
import ChannelRowButton from "./ChannelRowButton";
import { useMyDms } from "./useChannels";
import s from "./sidebar.module.css";

export default function DmList({
  onPicked,
  syncCurrent = false,
}: {
  onPicked?: () => void;
  /** 보고 있는 DM 상대의 이름이 바뀌면 헤더 이름도 맞추고, 그 DM 이 사라지면 #일반으로 돌아간다.
   *  한 곳(왼쪽 칸)에서만 켠다 */
  syncCurrent?: boolean;
}) {
  const { channel, setChannel } = useWorkspace();
  const { dms, error } = useMyDms();
  const [open, setOpen] = useState(false);
  const current = useRef(channel);
  current.current = channel;

  // 목록을 새로 받았을 때만 확인한다 (DM 을 열 때마다 확인하면, 방금 연 DM 이
  // 목록에 들어오기 전에 #일반으로 튕길 수 있다)
  useEffect(() => {
    if (!syncCurrent || !dms) return;
    const cur = current.current;
    if (cur.type !== "dm") return;
    const found = dms.find((d) => d.id === cur.id);
    if (!found) setChannel({ id: GENERAL_ID, name: "일반", type: "public" });
    else if (found.other.display_name !== cur.name) {
      setChannel({ ...cur, name: found.other.display_name });
    }
  }, [dms, syncCurrent, setChannel]);

  // 다른 영역이 id·이름만 넘겨 DM 으로 바꾸면(예: ① 의 메시지로 이동, 이름은 "DM") 상대 이름과 종류를 채운다
  useEffect(() => {
    if (!syncCurrent || !dms || channel.type) return;
    const found = dms.find((d) => d.id === channel.id);
    if (found) setChannel({ id: found.id, name: found.other.display_name, type: "dm" });
  }, [channel, dms, syncCurrent, setChannel]);

  function go(id: string, name: string) {
    setChannel({ id, name, type: "dm" });
    setOpen(false);
    onPicked?.();
  }

  return (
    <>
      <ul className={s.list}>
        {error && <li className={`${s.item} ${s.error}`}>DM 목록을 못 불러왔습니다: {error}</li>}
        {dms === null && !error && <li className={`${s.item} ${s.muted}`}>불러오는 중…</li>}
        {dms?.length === 0 && <li className={`${s.item} ${s.muted}`}>아직 DM 이 없습니다</li>}
        {dms?.map((d) => {
          const active = d.id === channel.id;
          return (
            <li key={d.id}>
              <ChannelRowButton
                channelId={d.id}
                label={`${d.other.display_name} 님과 DM`}
                active={active}
                onClick={() => go(d.id, d.other.display_name)}
              >
                <span aria-hidden="true">@</span>
                <span className={s.channelName}>{d.other.display_name}</span>
                {d.other.department && (
                  <span className={s.dmMeta} aria-hidden="true">
                    {d.other.department}
                  </span>
                )}
              </ChannelRowButton>
            </li>
          );
        })}
      </ul>
      <div className={s.channelActions}>
        <button type="button" className={`${s.textButton} ${s.iconText}`} onClick={() => setOpen(true)}>
          <PlusIcon />
          새 메시지
        </button>
      </div>
      {open && <NewDmDialog onClose={() => setOpen(false)} onStarted={go} />}
    </>
  );
}
