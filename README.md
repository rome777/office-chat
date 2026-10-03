# WorkOn

> 연결되면, 업무가 시작됩니다.

작은 회사를 위한 사내 메신저입니다. 주제별 채널과 스레드 대화에 카카오톡식 읽음 표시를 더했고, AI가 밀린 대화를 요약하고 할 일을 뽑아 줍니다.
바이브코딩 해커톤(2026-09-28 ~ 10-02) 과제 "사내 채팅어플 만들기" 결과물입니다.

- 배포 URL: https://office-chat-two.vercel.app
- 시연 계정 접속정보는 저장소에 두지 않고 별도로 전달합니다.

## 주요 기능

| 분류 | 기능 |
|---|---|
| 대화 | 채널 실시간 채팅(공개·비공개), 1:1 DM, 스레드, 파일·이미지 첨부, 검색 |
| 읽음·알림 | 대화별 미읽음 수, 메시지별 안 읽은 사람 수, DM·멘션·답글 알림 |
| 조직 | 부서 채널, 조직도, 프로필 카드, 담당 부서만 쓰는 공지 채널 |
| 일정 | 캘린더(반복 일정 포함), 회의실 예약(겹치는 예약 차단), 일정 알림 |
| 홈 | 오늘의 일정·내 할 일·회사 공지·최근 대화를 모은 대시보드 |
| AI | 대화 요약(원문 링크 포함), 할 일 추출, 말투 변환 |

기능별 요구 사항은 [PRD.md 5절](DevelopDoc/PRD.md#functional-requirements)을 봅니다.

## 기술 스택

![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI_API-412991?style=flat-square)

## 개발 문서

| 문서 | 내용 |
|---|---|
| [PRD.md](DevelopDoc/PRD.md) | 제품 요구 사항 |
| [TECH_SPEC.md](DevelopDoc/TECH_SPEC.md) | 기술 명세 (데이터 구조, 권한, 실시간 동기화) |
| [WORK_UNITS.md](DevelopDoc/WORK_UNITS.md) | 단위 작업 명세와 실측 기록 |
| [FINAL_CHECKLIST.md](DevelopDoc/FINAL_CHECKLIST.md) | 최종 체크리스트와 결과 |
| [CLAUDE.md](CLAUDE.md) | AI 코딩 도구 작업 규칙 (축약판: AGENTS.md·GEMINI.md) |

## 팀

김송이 · 이호섭
