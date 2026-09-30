"use client";

// ③ 헤더의 알림 버튼: 안 읽은 수 배지, 알림 목록, 토스트, 브라우저 알림, "알림 켜기" 안내, 탭 제목의 (N).
// 띄우기 규칙은 useNotifications 가 정하고, 여기서는 어떻게 띄울지만 정한다.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useSelf } from "@/components/chat/useSelf";
import SafeText from "@/components/chat/SafeText";
import { TYPE_LABEL, isLooking, notificationHref, useNotifications, type Arrival, type NotificationView } from "./useNotifications";
import { onOpenRequest, publishUnread } from "./bellStore";
import s from "./notifications.module.css";

const TOAST_MS = 6000;
const MAX_TOASTS = 3;
const BANNER_KEY = "office-chat:notify-banner-dismissed";

type Permission = NotificationPermission | "unsupported";
type Toast = { key: number; arrival: Arrival };

function currentPermission(): Permission {
  // 브라우저 알림은 HTTPS 나 localhost 에서만 된다 (IP 로 접속하면 없다)
  if (typeof window === "undefined" || !("Notification" in window) || !window.isSecureContext) return "unsupported";
  return Notification.permission;
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export default function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const { channel, panel } = useWorkspace();
  const self = useSelf();
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [permission, setPermission] = useState<Permission>("unsupported");
  const [bannerHidden, setBannerHidden] = useState(true);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const toastSeq = useRef(0);

  useEffect(() => {
    setPermission(currentPermission());
    try {
      setBannerHidden(localStorage.getItem(BANNER_KEY) === "1");
    } catch {
      setBannerHidden(false);
    }
  }, []);

  const go = useCallback(
    (n: NotificationView) => {
      router.push(notificationHref(n));
      setOpen(false);
    },
    [router],
  );

  const onArrive = useCallback(
    (arrival: Arrival) => {
      const toast = () => {
        const key = ++toastSeq.current;
        setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { key, arrival }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.key !== key)), TOAST_MS);
      };
      if (isLooking()) return toast();
      if (currentPermission() === "granted") {
        const title = arrival.kind === "one" ? arrival.item.title : "오피스톡";
        const body = arrival.kind === "one" ? `${TYPE_LABEL[arrival.item.type]} · ${arrival.item.preview}` : `새 알림 ${arrival.count}개`;
        try {
          // tag 를 알림 id 로 주면 같은 사람이 탭을 여러 개 열어도 브라우저가 하나로 합친다
          const shown = new Notification(title, { body, tag: arrival.kind === "one" ? `notification-${arrival.item.id}` : "notification-many" });
          shown.onclick = () => {
            window.focus();
            if (arrival.kind === "one") go(arrival.item);
            else setOpen(true);
            shown.close();
          };
          return;
        } catch {
          // 모바일 Chrome 은 new Notification 을 막는다 (서비스 워커로만 된다) → 아래 토스트로
        }
      }
      // 권한이 없으면: 탭이 보이면 토스트, 아니면 탭 제목의 (N) 으로만 알린다
      if (document.visibilityState === "visible") toast();
    },
    [go],
  );

  // 대시보드·캘린더에 있을 때는 대화를 보고 있지 않다 (화면 상태의 channel 은 채팅으로 돌아갈 때를 위해 남아 있다)
  const onChat = pathname === "/chat";
  const { items, unread, markRead, markAllRead } = useNotifications({
    selfId: self?.id ?? null,
    currentChannelId: onChat ? channel.id : "",
    openThreadId: onChat && panel?.kind === "thread" ? panel.messageId : null,
    onArrive,
  });

  // 왼쪽 메뉴의 "알림"·대시보드 카드가 같은 숫자를 보이고 이 목록을 연다 (구독은 여기 하나)
  useEffect(() => publishUnread(unread), [unread]);
  useEffect(() => onOpenRequest(() => setOpen(true)), []);

  // 안 읽은 알림 수는 상황과 관계없이 탭 제목에도 보인다.
  // Next.js 는 페이지를 이동할 때(router.push) 제목을 다시 씌운다 → 1초마다 확인해서 숫자가 빠졌으면 다시 붙인다.
  // 제목이 바뀔 때마다 고치는 방식(MutationObserver)은 Next.js 와 서로 되받아 고치며 무한 반복에 빠져 페이지가 멈췄다 (2026-09-29)
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\)\s*/, "").trim() || "오피스톡";
      const wanted = unread > 0 ? `(${unread}) ${base}` : base;
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const timer = setInterval(apply, 1000);
    return () => clearInterval(timer);
  }, [unread]);

  // 목록 바깥을 누르거나 Esc 면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openItem(n: NotificationView) {
    markRead([n.id]);
    go(n);
  }

  // 권한 요청은 사용자가 버튼을 눌렀을 때만 할 수 있다 (브라우저가 자동 요청을 막는다)
  async function enableBrowserAlerts() {
    if (!("Notification" in window)) return;
    setPermission(await Notification.requestPermission());
  }

  function dismissBanner() {
    setBannerHidden(true);
    try {
      localStorage.setItem(BANNER_KEY, "1");
    } catch {}
  }

  const permissionHelp =
    permission === "denied"
      ? "브라우저 알림이 꺼져 있습니다. 주소창 왼쪽 자물쇠 → 사이트 설정 → 알림을 허용으로 바꾸면 켜집니다."
      : permission === "unsupported"
        ? "이 주소에서는 브라우저 알림을 쓸 수 없습니다 (HTTPS 나 localhost 에서만). 화면 안 알림과 목록은 그대로 됩니다."
        : null;

  return (
    <span className={s.wrap} ref={wrapRef}>
      <button
        className={s.bell}
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `알림, 안 읽은 알림 ${unread}개` : "알림"}
        aria-expanded={open}
      >
        알림
        {unread > 0 && <span className={s.badge}>{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className={s.dropdown} role="dialog" aria-label="알림 목록">
          <div className={s.dropHead}>
            <strong>알림</strong>
            <button className="link" onClick={markAllRead} disabled={unread === 0}>
              모두 읽음
            </button>
          </div>
          {permission === "default" && (
            <p className={s.permission}>
              다른 탭을 보고 있을 때도 알림을 받으려면{" "}
              <button className="link" onClick={() => void enableBrowserAlerts()}>
                브라우저 알림 켜기
              </button>
            </p>
          )}
          {permissionHelp && <p className={`${s.permission} muted`}>{permissionHelp}</p>}
          {items.length === 0 ? (
            <p className={`${s.empty} muted`}>알림이 없습니다</p>
          ) : (
            <ul className={s.list}>
              {items.map((n) => (
                <li key={n.id}>
                  <button className={`${s.item} ${n.read_at ? "" : s.unread}`} onClick={() => openItem(n)}>
                    <span className={s.itemHead}>
                      <span className={s.type}>{TYPE_LABEL[n.type]}</span>
                      <strong>{n.title}</strong>
                      <time className="muted">{formatTime(n.created_at)}</time>
                    </span>
                    <span className={s.preview}>
                      <SafeText text={n.preview} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 로그인 뒤 한 번 권한을 권한다. 거부해도 토스트·목록·탭 제목 숫자는 된다 */}
      {permission === "default" && !bannerHidden && (
        <div className={s.banner} role="note">
          <span>다른 탭을 보고 있어도 DM·멘션 알림을 받으려면 브라우저 알림을 켜 주세요.</span>
          <button className={s.bannerOn} onClick={() => void enableBrowserAlerts()}>
            알림 켜기
          </button>
          <button className="link" onClick={dismissBanner}>
            나중에
          </button>
        </div>
      )}

      <div className={s.toasts} aria-live="polite">
        {toasts.map((t) =>
          t.arrival.kind === "one" ? (
            <button
              key={t.key}
              className={s.toast}
              onClick={() => {
                const item = (t.arrival as { item: NotificationView }).item;
                openItem(item);
                setToasts((prev) => prev.filter((x) => x.key !== t.key));
              }}
            >
              <span className={s.itemHead}>
                <span className={s.type}>{TYPE_LABEL[t.arrival.item.type]}</span>
                <strong>{t.arrival.item.title}</strong>
              </span>
              <span className={s.preview}>
                <SafeText text={t.arrival.item.preview} />
              </span>
            </button>
          ) : (
            <button
              key={t.key}
              className={s.toast}
              onClick={() => {
                setOpen(true);
                setToasts((prev) => prev.filter((x) => x.key !== t.key));
              }}
            >
              <strong>알림 {t.arrival.count}개</strong>
              <span className={s.preview}>연결이 끊긴 동안 온 알림입니다. 눌러서 목록 보기</span>
            </button>
          ),
        )}
      </div>
    </span>
  );
}
