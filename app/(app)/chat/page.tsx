// 채팅 (/chat). 채널은 ?c=<채널 id>, 메시지는 ?m=<메시지 id> 로 연다. 화면은 components/shell/ChatWorkspace.

import ChatWorkspace from "@/components/shell/ChatWorkspace";

export const metadata = { title: "메시지 · 오피스톡" };

export default function ChatPage() {
  return <ChatWorkspace />;
}
