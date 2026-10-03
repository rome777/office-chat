# CLAUDE.md — 이 저장소의 작업 규칙

팀원 둘(김송이·이호섭)의 AI 코딩 도구가 모두 따르는 **규칙 원본**이다.
`AGENTS.md`(Codex 등)·`GEMINI.md`(Gemini/Antigravity)는 이 파일의 축약판이다. 셋이 다르면 이 파일이 이긴다.
이 파일을 고치면 두 축약판에도 반영한다.

해커톤(2026-09-28 ~ 10-02)은 제출을 마쳤다. 그 기간의 작업 기록은 [DevelopDoc/WORK_UNITS.md](DevelopDoc/WORK_UNITS.md) 에 닫힌 채 남아 있고, 이후 작업은 아래 규칙을 따른다.
상태·수치는 여기에 쓰지 않는다. 구조와 알려진 함정은 [DevelopDoc/TECH_SPEC.md](DevelopDoc/TECH_SPEC.md) 에 있다.

## 언어 — 진행 상황은 항상 한국어로

- 작업 중 사용자에게 알리는 **진행 상황·중간 보고·완료 보고는 항상 한국어로** 쓴다. 도구 출력이나 참고 자료가 영어여도 사용자에게 보이는 글은 한국어다.
- 문서에 적는 실측 기록도 한국어로 쓴다.
- 코드·명령어·파일 이름·오류 메시지 원문은 번역하지 않고 그대로 둔다.

## 명령어 — Windows PowerShell 기준

팀원이 Windows PowerShell(5.1)에서 명령을 실행한다 (2026-09-29 결정). 사람에게 실행하라고 주는 명령과 문서에 적는 명령은 PowerShell 문법으로 쓴다.

- 코드 블록 태그는 `powershell`. 한 블록에 명령 하나.
- 환경 변수는 `$env:이름`. bash 식 `"$NAME"` 은 PowerShell 에서 "변수가 설정되지 않았습니다" 오류가 난다 (2026-09-29 `db push` 에서 겪음).
- 명령 잇기는 `;`. PowerShell 5.1 에는 `&&`·`||` 가 없다.
- `.env.local` 값이 필요하면 파일에서 읽어 `$env:` 에 넣는 줄을 따로 준다. 값을 화면에 찍지 않는다.

## 작업을 시작할 때

1. `git pull` 로 `develop` 의 최신 변경을 받는다.
2. 고칠 파일의 주인을 [TECH_SPEC.md](DevelopDoc/TECH_SPEC.md) 9절에서 확인한다. 남의 폴더 파일은 가져다 쓰기만 한다 (11절).

## 작업을 끝낼 때

코드를 바꾸는 커밋은 커밋하기 전에 문서를 먼저 고쳐 같은 커밋에 넣는다. 코드만 먼저 올리고 문서를 나중에 따로 올리지 않는다. 커밋한 뒤에 한 확인(원격 적용·검사·운영 URL 확인)의 결과만 문서 커밋을 따로 둘 수 있다.

1. 구조·권한·함정이 바뀌었으면 TECH_SPEC 해당 절을 고친다.
2. 사용자에게 보이는 기능이 바뀌었으면 PRD 기능 요구 사항과 README 기능 표를 고친다.
3. 잰 수치(지연·응답 시간·비용)는 WORK_UNITS "실측 기록"에 잰 날짜와 환경을 함께 적는다.
4. 사용자에게 마지막에 무엇을 갱신했는지 한 줄로 알린다. 갱신할 것이 없었으면 왜 없었는지 밝힌다.

WORK_UNITS 의 진행 현황 표와 완료 조건은 해커톤 기록이라 고치지 않는다.

## 문서 구조 (바꾸지 않는다)

- 최상단: `README.md`(서비스 소개), `CLAUDE.md`·`AGENTS.md`·`GEMINI.md`(작업 규칙)
- `DevelopDoc/`: `PRD.md`, `TECH_SPEC.md`, `WORK_UNITS.md`, `FINAL_CHECKLIST.md` — 해커톤 제출 형식이라 파일 이름과 위치가 고정이다
- 상태 파일(`STATUS.md`)은 따로 두지 않는다
- 문서는 한국어로 쓴다

## Git

- `develop` 에는 직접 푸시해도 된다. 푸시하기 전에 `git pull` 로 남의 변경을 먼저 받는다.
- `main` 에도 **직접 푸시해도 된다** (2026-09-30 이호섭 결정. 그전에는 `develop` 에서 PR 로만). PR 로 넣어도 된다.
- **`main` 에 푸시하거나 머지하면 곧바로 운영 배포된다** (Vercel GitHub 연동, 따로 `vercel deploy` 를 치지 않는다). 그래서 `main` 에는 `develop` 과 같은 커밋만 올린다: `develop` 을 먼저 `git pull` 해서 합치고 `npm run build` 가 통과한 뒤 `main` 에서 `develop` 을 머지해 푸시한다 (`git switch main; git pull; git merge --no-ff develop; git push origin main`). `main` 에는 예전 PR 머지 커밋이 있어 `git push origin develop:main` 은 거부된다 — 강제 푸시하지 않는다. `main` 에서 따로 고치지 않는다 (두 브랜치의 내용이 갈라진다).
- 개인 브랜치를 쓸 때는 `develop-<이름>-<기능>` (예: `develop-hslee-step1-chat`).
- 자세한 규칙은 TECH_SPEC 11절.

## DB (Supabase)

- 구조를 바꿀 때는 `supabase/migrations/` 에 **새 파일**을 만든다. 이미 원격에 적용한 파일은 고치지 않는다.
- 권한은 DB 정책(RLS)과 컬럼 권한으로 지킨다. 화면에서 버튼을 숨기는 것은 권한이 아니다.
- DB 를 바꾼 뒤에는 `npm run check:db` 와 `npm run check:step1` 을 돌린다.
- 원격 DB 하나를 팀 전체와 운영 배포가 같이 쓴다. 테스트 데이터는 끝나면 지운다.

## 비밀값

API 키·토큰·비밀번호는 `.env.local` 에만 둔다. 코드·문서·커밋 메시지에 쓰지 않는다. `SUPABASE_SERVICE_ROLE_KEY` 는 서버와 스크립트에서만 쓴다.
