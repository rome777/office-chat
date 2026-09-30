"use client";

// ② 채널 찾기. 공개 채널을 이름으로 찾아 가입하거나, 이미 가입한 채널로 들어간다.
// 비공개 채널은 여기에 나오지 않는다.

import { useEffect, useState } from "react";
import type { ChannelSummary } from "@/lib/types/channel";
import { GENERAL_ID, joinChannel, listPublicChannels, subscribeChannels } from "./channelSource";
import Modal from "./Modal";
import s from "./sidebar.module.css";

export default function BrowseChannelsDialog({
  onClose,
  onOpen,
  onCreate,
}: {
  onClose: () => void;
  onOpen: (c: ChannelSummary) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ChannelSummary[] | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void listPublicChannels(query).then(
        (found) => {
          if (!alive) return;
          setList(found.filter((c) => c.id !== GENERAL_ID)); // #일반 은 목록에서 숨긴다 (2026-09-30)
          setError(null);
        },
        (e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        },
      );
    const timer = setTimeout(load, 150);
    const unsubscribe = subscribeChannels(load);
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [query]);

  async function join(c: ChannelSummary) {
    setJoining(c.id);
    setError(null);
    try {
      onOpen(await joinChannel(c.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJoining(null);
    }
  }

  return (
    <Modal onClose={onClose}>
      <section
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="채널 찾기"
      >
        <h2>채널 찾기</h2>
        <input
          autoFocus
          type="search"
          className={s.searchInput}
          placeholder="채널 이름으로 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <ul className={s.browseList}>
          {list === null && <li className={s.muted}>불러오는 중…</li>}
          {list?.length === 0 && (
            <li className={s.muted}>
              맞는 공개 채널이 없습니다.{" "}
              <button type="button" className={s.textButton} onClick={onCreate}>
                새로 만들기
              </button>
            </li>
          )}
          {list?.map((c) => {
            const info = (
              <div className={s.browseInfo}>
                <span className={s.channelName}># {c.name}</span>
                <span className={s.muted}>
                  {c.member_count === null ? "공개 채널" : `멤버 ${c.member_count}명`}
                </span>
              </div>
            );
            // 참여 중인 채널은 줄 전체가 그 채널로 가는 버튼이다. 오른쪽에는 할 일(참여)만 버튼으로 둔다
            return c.joined ? (
              <li key={c.id} className={s.joined}>
                <button type="button" className={s.browseRow} onClick={() => onOpen(c)}>
                  {info}
                  <span className={s.joinedMark}>✓ 참여 중</span>
                </button>
              </li>
            ) : (
              <li key={c.id}>
                {info}
                <button
                  type="button"
                  className={s.primary}
                  disabled={joining !== null}
                  onClick={() => void join(c)}
                >
                  {joining === c.id ? "참여하는 중…" : "참여"}
                </button>
              </li>
            );
          })}
        </ul>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <div className={s.actions}>
          <button type="button" className={s.secondary} onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </Modal>
  );
}
