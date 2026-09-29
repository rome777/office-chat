// 멘션 규칙 한 곳 (2026-09-29). 본문에는 "@handle"(아이디)로 저장하고, 사람이 보는 곳은 모두 "@이름"으로 보여 준다.
// 아이디는 겹치지 않고 띄어쓰기가 없어 DB 트리거가 누구를 불렀는지 정확히 안다 (20260929130000_message_notifications.sql).
// 이름은 동명이인·띄어쓰기가 있어 저장에 쓰지 않는다. 화면(채팅·알림·검색)과 AI(요약·할 일)가 이 파일을 같이 쓴다.

/** 저장된 본문 속 멘션 "@handle". 앞이 글자인 @(메일 주소)는 멘션이 아니다 — SafeText·DB 트리거와 같은 규칙 */
const MENTION = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/gu;
/** 멘션 뒤에 이 글자가 붙어 있으면 이름이 끝나지 않은 것이다 */
const NAME_CHAR = /[\p{L}\p{N}_-]/u;

export type MentionPerson = { handle: string; display_name: string; department: string | null };

/**
 * handle(소문자) → 화면에 보일 이름. 같은 이름이 둘 이상이면 "이름(부서)" 로 구분한다.
 * 입력창에 넣는 글자도 이것이라, 보낼 때 이 글자로 누구인지 되찾는다 (storeMentions)
 */
export function mentionLabels(people: readonly MentionPerson[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const p of people) count.set(p.display_name, (count.get(p.display_name) ?? 0) + 1);
  return new Map(
    people.map((p) => [
      p.handle.toLowerCase(),
      (count.get(p.display_name) ?? 0) > 1 && p.department ? `${p.display_name}(${p.department})` : p.display_name,
    ]),
  );
}

/** 저장된 본문의 "@handle" 을 "@이름" 으로 바꾼다 (모르는 handle 은 그대로). 알림 미리보기·검색 결과·AI 에 보낼 때 */
export function showMentions(text: string, labels: ReadonlyMap<string, string>): string {
  return text.replace(MENTION, (whole, handle: string) => {
    const name = labels.get(handle.toLowerCase());
    return name ? `@${name}` : whole;
  });
}

/**
 * 입력창의 "@이름" 을 저장용 "@handle" 로 바꾼다. 이름(라벨)이 한 사람만 가리킬 때만 바꾸고,
 * 둘 이상이면 그대로 둔다 — 누구인지 모르면 알림을 보내지 않는다. 이름 바로 뒤에 글자가 붙어 있으면("@정대현님") 바꾸지 않는다.
 * 긴 이름부터 맞춰서 "@김민" 이 "@김민수" 를 먹지 않게 한다.
 * 저장되는 아이디는 소문자다 (userB → @userb). handle 은 대소문자 없이 유일하고, 트리거·화면·AI 모두 소문자로 맞추므로 같다.
 */
export function storeMentions(text: string, labels: ReadonlyMap<string, string>): string {
  const byLabel = new Map<string, string | null>(); // 라벨 → handle (두 사람이면 null)
  for (const [handle, label] of labels) byLabel.set(label, byLabel.has(label) ? null : handle);
  const sorted = [...byLabel.entries()].filter((e): e is [string, string] => e[1] !== null).sort((a, b) => b[0].length - a[0].length);
  if (sorted.length === 0 || !text.includes("@")) return text;

  let out = "";
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at === -1) break;
    out += text.slice(i, at);
    const before = at > 0 ? text[at - 1] : "";
    const hit = before && NAME_CHAR.test(before) ? undefined : sorted.find(([label]) => text.startsWith(label, at + 1) && !NAME_CHAR.test(text[at + 1 + label.length] ?? ""));
    if (hit) {
      out += `@${hit[1]}`;
      i = at + 1 + hit[0].length;
    } else {
      out += "@";
      i = at + 1;
    }
  }
  return out + text.slice(i);
}
