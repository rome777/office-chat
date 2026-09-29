"use client";

// ② 다이렉트 메시지 목록 + "새 메시지". 왼쪽 칸과 헤더의 채널 전환(좁은 화면)이 함께 쓴다.

import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import NewDmDialog from "./NewDmDialog";
import { useMyDms } from "./useChannels";
import s from "./sidebar.module.css";

export default function DmList({
  onPicked,
  syncCurrent = false,
}: {
  onPicked?: () => void;
  /** 보고 있는 DM 상대의 이름이 바뀌면 헤더 이름도 맞춘다. 한 곳(왼쪽 칸)에서만 켠다 */
  syncCurrent?: boolean;
}) {
  const { channel, setChannel } = useWorkspace();
  const { dms, error } = useMyDms();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!syncCurrent || !dms || channel.type !== "dm") return;
    const now = dms.find((d) => d.id === channel.id)?.other.display_name;
    if (now && now !== channel.name) setChannel({ ...channel, name: now });
  }, [dms, channel, syncCurrent, setChannel]);

  function go(id: string, name: string) {
    setChannel({ id, name, type: "dm" });
    setOpen(false);
    onPicked?.();
  }

  return (
    <>
      <ul className={s.list}>
        {error && <li className={s.error}>DM 목록을 못 불러왔습니다: {error}</li>}
        {dms === null && !error && <li className={s.muted}>불러오는 중…</li>}
        {dms?.length === 0 && <li className={s.muted}>아직 DM 이 없습니다</li>}
        {dms?.map((d) => {
          const active = d.id === channel.id;
          return (
            <li key={d.id}>
              <button
                type="button"
                className={`${s.item} ${s.channelButton} ${active ? s.active : ""}`}
                aria-current={active ? "page" : undefined}
                aria-label={`${d.other.display_name} 님과 DM`}
                onClick={() => go(d.id, d.other.display_name)}
              >
                <span aria-hidden="true">@</span>
                <span className={s.channelName}>{d.other.display_name}</span>
                {d.other.department && (
                  <span className={s.dmMeta} aria-hidden="true">
                    {d.other.department}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className={s.channelActions}>
        <button type="button" className={s.textButton} onClick={() => setOpen(true)}>
          + 새 메시지
        </button>
      </div>
      {open && <NewDmDialog onClose={() => setOpen(false)} onStarted={go} />}
    </>
  );
}
