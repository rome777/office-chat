// ① 스레드 안의 답글로 이동할 때 쓰는 작은 저장소.
// 가운데 칸(ChatPane)이 `?m=<답글 id>` 를 받으면 부모 스레드를 열면서 여기에 답글 id 를 남기고,
// 스레드 패널(ThreadPanel)이 답글을 불러온 뒤 꺼내서 그 답글로 스크롤·강조한다.
// 패널 상태(WorkspaceContext, 공통 틀)는 고치지 않으려고 따로 뒀다.

let pending: number | null = null;
const listeners = new Set<() => void>();

export function focusReply(messageId: number) {
  pending = messageId;
  listeners.forEach((l) => l());
}

/** 남겨 둔 답글 id 가 이 목록에 있으면 꺼내고(한 번만) 돌려준다 */
export function takeReplyFocus(replyIds: number[]): number | null {
  if (pending === null || !replyIds.includes(pending)) return null;
  const id = pending;
  pending = null;
  return id;
}

export function onReplyFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
