"use client";

// ② 헤더의 검색창. 두 글자 이상 치면 내가 멤버인 대화에서 찾고, 결과를 누르면 그 메시지로 간다
// (`/chat?m=<메시지 id>` — ① 이 채널을 바꾸고 강조한다. 답글이면 스레드를 연다).

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Person } from "@/lib/types/people";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { getPeople, useMentionLabels } from "@/components/people/directory";
import { showMentions } from "@/lib/mentions";
import { listMyChannels, listMyDms } from "@/components/sidebar/channelSource";
import { LockIcon } from "@/components/sidebar/ActionIcons";
import { formatKstDay, formatKstTime } from "@/components/calendar/time";
import { MIN_QUERY, searchMessages, snippet, type SearchHit } from "./searchSource";
import s from "./search.module.css";

type Found = { hits: SearchHit[]; elapsedMs: number; query: string };

export default function SearchBox() {
  const router = useRouter();
  const { channel } = useWorkspace();
  const [query, setQuery] = useState("");
  const [onlyHere, setOnlyHere] = useState(false);
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  // 검색창을 다시 누르면 같은 검색어라도 새로 찾는다 (그 사이 새 메시지·가입한 채널이 있을 수 있다)
  const [tick, setTick] = useState(0);
  const [labels, setLabels] = useState<Map<string, { name: string; locked: boolean }>>(new Map());
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const mentionNames = useMentionLabels(); // 본문의 "@아이디" 를 "@이름" 으로 보이고, 이름으로도 멘션을 찾는다
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const trimmed = query.trim();
  const tooShort = [...trimmed].length < MIN_QUERY;

  // 입력이 멈추면 찾는다. 늦게 온 옛 결과가 새 결과를 덮지 않게 마지막 요청만 쓴다
  useEffect(() => {
    if (tooShort) {
      setFound(null);
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void searchMessages(trimmed, { channelId: onlyHere ? channel.id : undefined, labels: mentionNames }).then(
        (r) => {
          if (!alive) return;
          setFound({ ...r, query: trimmed.normalize("NFC") });
          setError(null);
          setActive(0);
          setLoading(false);
        },
        (e: unknown) => {
          if (!alive) return;
          setFound(null); // 옛 결과가 오류 옆에 남지 않게
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        },
      );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [trimmed, tooShort, onlyHere, channel.id, tick, mentionNames]);

  // 결과에 보일 대화 이름과 작성자 이름
  useEffect(() => {
    if (!found?.hits.length) return;
    let alive = true;
    void Promise.all([listMyChannels(), listMyDms()]).then(
      ([chs, dms]) => {
        if (!alive) return;
        const m = new Map<string, { name: string; locked: boolean }>();
        chs.forEach((c) => m.set(c.id, { name: `#${c.name}`, locked: c.type === "private" }));
        dms.forEach((d) => m.set(d.id, { name: `@${d.other.display_name}`, locked: false }));
        setLabels(m);
      },
      () => {},
    );
    const ids = [...new Set(found.hits.map((h) => h.user_id).filter((v): v is string => !!v))];
    if (ids.length) {
      void getPeople(ids).then(
        (list) => alive && setPeople(new Map(list.map((p) => [p.id, p]))),
        () => {},
      );
    }
    return () => {
      alive = false;
    };
  }, [found]);

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function go(hit: SearchHit) {
    setOpen(false);
    router.push(`/chat?m=${hit.id}`);
  }

  const hits = found?.hits ?? [];
  const showPanel = open && !tooShort;

  return (
    <div className={s.wrap} ref={box}>
      <input
        className={s.box}
        type="search"
        role="combobox"
        placeholder="메시지 검색"
        aria-label="메시지 검색"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && hits[active] ? `${listId}-${hits[active].id}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setTick((t) => t + 1);
        }}
        // Tab 등으로 검색 영역 밖으로 초점이 나가면 닫는다
        onBlur={(e) => {
          if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={(e) => {
          // 한글 조합 중에 누른 키는 무시한다 (조합이 끝나기 전 Enter 가 이전 결과를 열지 않게)
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Escape") {
            // 검색창의 Esc 는 결과만 닫는다 (헤더의 채널 목록 등 다른 곳은 그대로)
            e.preventDefault();
            if (showPanel) setOpen(false);
            else setQuery("");
          } else if (e.key === "ArrowDown" && hits.length) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(hits.length - 1, i + 1));
          } else if (e.key === "ArrowUp" && hits.length) {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && showPanel && hits[active]) {
            e.preventDefault();
            // 지금 검색어의 결과가 아직 안 왔으면 이전 결과를 열지 않는다
            if (loading || found?.query !== trimmed.normalize("NFC")) return;
            go(hits[active]);
          }
        }}
      />
      {showPanel && (
        <div className={s.panel}>
          <div className={s.panelHead}>
            <label className={s.scope}>
              <input
                type="checkbox"
                checked={onlyHere}
                onChange={(e) => setOnlyHere(e.target.checked)}
              />
              이 대화에서만
            </label>
            <span className={s.meta} aria-live="polite">
              {loading
                ? "찾는 중…"
                : found
                  ? `${hits.length}건 · ${(found.elapsedMs / 1000).toFixed(2)}초`
                  : ""}
            </span>
          </div>
          {error && <p className={s.error}>검색하지 못했습니다: {error}</p>}
          {!loading && found && hits.length === 0 && !error && (
            <p className={s.empty}>&ldquo;{found.query}&rdquo; 가 들어간 메시지가 없습니다</p>
          )}
          <ul id={listId} className={s.results} role="listbox" aria-label="검색 결과">
            {hits.map((h, i) => {
              const [before, match, after] = snippet(showMentions(h.body, mentionNames), found!.query);
              const who = h.user_id ? (people.get(h.user_id)?.display_name ?? "…") : "알 수 없음";
              return (
                <li
                  key={h.id}
                  id={`${listId}-${h.id}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? s.activeRow : undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault() /* 누르는 동안 검색창 초점이 빠지지 않게 */}
                  onClick={() => go(h)}
                >
                  <div className={s.rowHead}>
                    <span className={s.where}>{labels.get(h.channel_id)?.name ?? "대화"}</span>
                    {labels.get(h.channel_id)?.locked && (
                      <span className={s.lock} title="비공개 채널">
                        <LockIcon />
                      </span>
                    )}
                    {h.parent_id !== null && <span className={s.reply}>답글</span>}
                    <span className={s.who}>{who}</span>
                    <span className={s.when}>
                      {formatKstDay(h.created_at)} {formatKstTime(h.created_at)}
                    </span>
                  </div>
                  <p className={s.text}>
                    {before}
                    {match && <mark>{match}</mark>}
                    {after}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
