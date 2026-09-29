// 공통 틀 — 화면을 세 칸으로 나눈다. 왼쪽 ②, 가운데 ①, 오른쪽 ③.
// 각 칸 안은 담당 영역이 채우고, 이 파일은 고치지 않는다.

import ChatPane from "@/components/chat/ChatPane"; // ①
import RightPanel from "@/components/panel/RightPanel"; // ③
import Sidebar from "@/components/sidebar/Sidebar"; // ②
import Header from "./Header";
import s from "./workspace.module.css";

export default function Workspace() {
  return (
    <div className={s.shell}>
      <div className={s.side}>
        <Sidebar />
      </div>
      <Header />
      <main className={s.main}>
        <ChatPane />
      </main>
      <div className={s.panelSlot}>
        <RightPanel />
      </div>
    </div>
  );
}
