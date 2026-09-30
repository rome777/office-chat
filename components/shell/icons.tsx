// 앱 틀(메뉴·대시보드·채팅 머리)에서 쓰는 선 아이콘. 24 칸 기준, 선 색은 글자 색을 따른다 (sidebar/ActionIcons 와 같은 규칙)

type P = { size?: number };

function Svg({ size = 20, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 10.5 12 3.5l8.5 7" />
    <path d="M5.5 9v11h13V9" />
    <path d="M10 20v-6h4v6" />
  </Svg>
);

export const ChatIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 5.5h16v10H9l-5 4Z" />
    <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" />
  </Svg>
);

export const CalendarIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);

export const RoomIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 20V4h10v16" />
    <path d="M15 6h4v14" />
    <path d="M3 20h18M12 12h.01" />
  </Svg>
);

export const BellIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Svg>
);

export const BellOffIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8.5 5.6A6 6 0 0 1 18 11v4" />
    <path d="M6 11v5l-1.5 2H17" />
    <path d="M10 20.5a2 2 0 0 0 4 0M3 3l18 18" />
  </Svg>
);

export const OrgIcon = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="5" rx="1" />
    <rect x="3" y="16" width="6" height="5" rx="1" />
    <rect x="15" y="16" width="6" height="5" rx="1" />
    <path d="M12 8v4M6 16v-4h12v4" />
  </Svg>
);

export const SettingsIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5" />
  </Svg>
);

export const StarIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    width={p.size ?? 18}
    height={p.size ?? 18}
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z" />
  </svg>
);

export const PinIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 3.5 20.5 9.5l-3 1-3.5 3.5.5 4-2 2-9-9 2-2 4 .5L13.5 6Z" />
    <path d="m8 16-4.5 4.5" />
  </Svg>
);

export const UsersIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14a6.5 6.5 0 0 1 3.5 6" />
  </Svg>
);

export const EditIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16Z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);

export const LogoutIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h5v16h-5" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Svg>
);

export const SmileIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 10h.01M15 10h.01" />
  </Svg>
);

export const ReplyIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h10a6 6 0 0 1 6 6" />
  </Svg>
);

export const SparkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z" />
  </Svg>
);

export const ChevronIcon = ({ open, ...p }: P & { open?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    width={p.size ?? 16}
    height={p.size ?? 16}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ArrowIcon = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const ComposeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4H5v15h15v-7" />
    <path d="M18 3l3 3-8 8H10v-3Z" />
  </Svg>
);

export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);

export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const HashIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 4 7 20M17 4l-2 16M4.5 9h16M3.5 15h16" />
  </Svg>
);

export const PersonIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </Svg>
);

export const PhoneIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z" />
  </Svg>
);

export const MailIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </Svg>
);

export const BuildingIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 20V5l8-2v17M12 8h8v12M2.5 20h19" />
    <path d="M7.5 8h1M7.5 12h1M7.5 16h1M15.5 12h1M15.5 16h1" />
  </Svg>
);

export const ChatBubbleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4.5c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L4.5 19.5l1.2-3.6a6.5 6.5 0 0 1-2.2-4.4c0-3.9 3.8-7 8.5-7Z" />
  </Svg>
);
