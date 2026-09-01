# GitHub Copilot — 여소남 OS

루트 `AGENTS.md`와 현재 작업 경로의 도메인 SSOT를 따른다. 이 파일은 Copilot 표면의 최소 보조 지침이다.

- 인접 구현과 테스트를 먼저 찾아 기존 패턴을 유지한다.
- UI에 파싱·정산·권한 로직을 새로 넣지 않는다.
- API 응답, 인증, tenant 경계는 기존 helper를 재사용한다.
- DB 변경은 migration과 RLS 검증 없이 제안하지 않는다.
- Production DB·예약·결제·외부 발행·자격증명 변경을 자동 실행하지 않는다.
- `docs/audits`와 `docs/archive`를 현재 정책으로 취급하지 않는다.
- `.agents/skills`가 스킬 원본이고 `.claude/skills`는 생성 사본이다.

큰 변경은 `docs/agent-workflow-current-ssot.md`, 문서 변경은 `docs/ai-agent-doc-automation.md`를 확인한다.
