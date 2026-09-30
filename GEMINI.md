# GEMINI.md

[CLAUDE.md](CLAUDE.md) 의 축약판이다 (Gemini/Antigravity). 둘이 다르면 CLAUDE.md 가 이긴다.

- **진행 상황·중간 보고·완료 보고는 항상 한국어로** 쓴다. WORK_UNITS 진행 현황·실측 기록도 한국어. 코드·명령어·파일 이름·오류 원문은 그대로 둔다.
- **명령어는 Windows PowerShell(5.1) 기준**: 코드 블록 태그 `powershell`, 환경 변수 `$env:이름` (bash 식 `"$NAME"` 은 안 됨), 잇기는 `;` (`&&` 없음). `.env.local` 값은 파일에서 읽어 `$env:` 에 넣고 화면에 찍지 않는다.
- 시작할 때 `git pull`. [WORK_UNITS.md](DevelopDoc/WORK_UNITS.md) 의 역할 분담·진행 현황을 읽는다. 파일 주인은 [TECH_SPEC.md](DevelopDoc/TECH_SPEC.md) 9절, 남의 폴더는 가져다 쓰기만 한다.
- **개발·테스트를 마치면 같은 커밋에서** WORK_UNITS 진행 현황의 그 작업 줄(상태·날짜·한 줄 설명)과 완료 조건 체크박스를 고친다. 체크박스가 다 차야 "완료" (기능은 다 됐고 환경 때문에 못 한 확인만 남으면 "완료" + `특이사항:` 으로 남은 것을 적는다). 잰 수치는 "실측 기록"에 날짜와 함께 적는다. 바뀐 구조는 TECH_SPEC, 보이는 기능은 README 에 반영한다. 무엇을 갱신했는지 한 줄로 알린다. **코드를 바꾸는 커밋은 모두 커밋 전에 문서를 고쳐 같은 커밋에 넣는다** (나중에 한 확인 결과만 따로 커밋).
- 문서 구조 고정: 최상단 README·CLAUDE·AGENTS·GEMINI, `DevelopDoc/` 에 PRD·TECH_SPEC·WORK_UNITS·FINAL_CHECKLIST. STATUS.md 는 두지 않는다. 한국어로 쓴다.
- `develop` 은 직접 푸시 가능(먼저 pull). `main` 도 직접 푸시 가능(2026-09-30) — 푸시·머지하면 곧바로 운영 배포. `develop` 을 pull·합치고 `npm run build` 통과 뒤 `git push origin develop:main`, `main` 에서 따로 고치지 않는다.
- DB 는 `supabase/migrations/` 에 새 파일로만 바꾼다(적용한 파일은 고치지 않음). 바꾼 뒤 `npm run check:db`·`npm run check:step1`.
- 비밀값은 `.env.local` 에만.
