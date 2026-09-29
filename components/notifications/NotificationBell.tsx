"use client";

// ③ 헤더의 알림 버튼. 알림 작업에서 안 읽은 수 배지·알림 목록·토스트·브라우저 알림을 붙인다.

import s from "./notifications.module.css";

export default function NotificationBell() {
  return (
    <button className={s.bell} disabled title="알림 (준비 중)" aria-label="알림">
      알림
    </button>
  );
}
