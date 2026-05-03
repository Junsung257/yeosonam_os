# OS 자동화 런북

## 목적
- 여러 세션/여러 에이전트에서 동시에 개발해도, 놓친 개선 항목을 자동으로 한 곳에 모읍니다.

## 자동 수집 구조
- 생성 파일: `docs/os-improvement-inbox.md`
- 생성 스크립트: `scripts/os-improvement-inbox.mjs`
- 실행 명령: `npm run os:inbox`

## 언제 자동 실행되나
- Cursor 프로젝트 훅: `.cursor/hooks.json`
  - `sessionStart` 시 자동 실행
  - `stop` 시 자동 실행

즉, 세션 시작/종료마다 최신 인박스가 갱신됩니다.

## 수집 항목
- Git 변경 파일 중 노이즈 제외 목록 (`.next`, 로그 등 제외)
- `src`, `docs`의 `TODO/FIXME/HACK/XXX` 마커
- 우선순위 체크리스트(P0~P3)

## 운영 루틴(권장)
1. 매일 시작 시 `docs/os-improvement-inbox.md` 확인
2. P0/P1 먼저 처리
3. 완료된 항목은 체크 후 다음 사이클 진행

## 참고
- 이 자동화는 로컬 개발 워크스페이스 기준입니다.
- Vercel 서버 크론은 로컬 Git 워킹트리를 볼 수 없으므로, 인박스 생성은 로컬 훅 방식이 가장 안정적입니다.
