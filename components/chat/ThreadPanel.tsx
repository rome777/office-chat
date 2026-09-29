// ① 스레드 패널. 오른쪽 패널(③)이 `{ kind: "thread" }` 일 때 이것을 그린다.

export default function ThreadPanel({ messageId }: { messageId: number }) {
  return <p className="muted">스레드 (준비 중) — 메시지 #{messageId}</p>;
}
