// ② 캘린더 시간 계산. DB 는 timestamptz(UTC), 화면은 항상 한국 시간으로 보여 준다.
// Vercel 서버는 UTC 라서 getHours()·toLocaleString() 을 그냥 쓰면 9시간 어긋난다 (TECH_SPEC 7절 "시간대").
// 한국은 서머타임이 없어 +09:00 고정으로 계산하고, 글자로 보여 줄 때는 Intl(Asia/Seoul)만 쓴다.

export const TIME_ZONE = "Asia/Seoul";
const OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 한국 시각 기준의 연·월·일·시·분·요일(0=일) */
export function kstParts(at: Date | string) {
  const k = new Date(new Date(at).getTime() + OFFSET_MS);
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth() + 1,
    day: k.getUTCDate(),
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
    weekday: k.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" (한국 날짜) */
export function kstDateKey(at: Date | string): string {
  const p = kstParts(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 한국 날짜·시각 입력값("2026-09-30", "10:00")을 실제 시각으로 */
export function fromKstInput(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+09:00`);
}

/** 실제 시각을 한국 날짜·시각 입력값으로 */
export function toKstInput(at: Date | string): { date: string; time: string } {
  const p = kstParts(at);
  return { date: kstDateKey(at), time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** 그날 한국 시각 0시 */
export function startOfKstDay(at: Date | string): Date {
  return fromKstInput(kstDateKey(at), "00:00");
}

/** 그 주 월요일 한국 시각 0시 */
export function startOfKstWeek(at: Date | string): Date {
  const day0 = startOfKstDay(at);
  const fromMonday = (kstParts(day0).weekday + 6) % 7;
  return addDays(day0, -fromMonday);
}

/** 시각 비교용 밀리초. DB 는 "+00:00"·마이크로초 형식으로 줄 수 있어 글자끼리 비교하면 틀린다 */
export const toMs = (at: Date | string) => new Date(at).getTime();

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * DAY_MS);
}

/** 한국 시각 0시부터 지난 분 */
export function kstMinuteOfDay(at: Date | string): number {
  const p = kstParts(at);
  return p.hour * 60 + p.minute;
}

const dayFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  month: "long",
  day: "numeric",
  weekday: "short",
});
const timeFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const monthFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "long",
});

/** "9월 30일 (수)" */
export const formatKstDay = (at: Date | string) => dayFmt.format(new Date(at));
/** "10:00" */
export const formatKstTime = (at: Date | string) => timeFmt.format(new Date(at));
/** "2026년 9월" */
export const formatKstMonth = (at: Date | string) => monthFmt.format(new Date(at));

/** "9월 30일 (수) 10:00~11:00" — 날짜가 바뀌면 끝에도 날짜를 붙인다 */
export function formatKstRange(start: string, end: string): string {
  const sameDay = kstDateKey(start) === kstDateKey(end);
  return `${formatKstDay(start)} ${formatKstTime(start)}~${
    sameDay ? "" : `${formatKstDay(end)} `
  }${formatKstTime(end)}`;
}
