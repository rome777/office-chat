// ② 왼쪽·위쪽(채널 목록·DM·사람 찾기) 영역의 타입

export type ChannelType = "public" | "private" | "dm";

/** 화면 상태(WorkspaceContext)가 들고 다니는 "지금 보는 대화" */
export type Channel = {
  id: string;
  name: string;
  /** 없으면 공개 채널로 본다 (Step 1 의 #일반) */
  type?: ChannelType;
};

/** 채널 목록·채널 찾기에 보이는 한 줄 (TECH_SPEC 4절 `channels` + 멤버 수·내 가입 여부) */
export type ChannelSummary = {
  id: string;
  name: string;
  type: ChannelType;
  /** 만든 사람. #일반처럼 시스템이 만든 채널은 null */
  created_by: string | null;
  created_at: string;
  /** 가입한 채널만 알 수 있다 (memberships 는 같은 채널 멤버끼리만 조회). 모르면 null */
  member_count: number | null;
  joined: boolean;
};
