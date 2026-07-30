# Feature Spec: Threads Full Autopilot

## Goal

여소남의 기존 Threads 주제 발굴·본문 생성·예약 발행 흐름에 댓글/멘션 수집, 안전 분류, 답변 생성, 실제 답글 게시, 중복 방지, 토큰 자동 갱신과 준비 상태 진단을 연결한다. 코드 배포 후 운영자가 올바른 Threads 장기 토큰만 발급하면 별도 개발 없이 작동해야 한다.

## Success Criteria

- [x] 최근 자사 Threads 게시물의 중첩 댓글을 주기적으로 수집한다.
- [x] 이미 여소남 계정이 답한 댓글과 처리 이력이 있는 댓글은 다시 답하지 않는다.
- [x] 일반 반응·여행 질문에는 자동 답변을 생성하고 게시할 수 있다.
- [x] 예약 변경, 결제·환불, 분쟁, 개인정보, 법률·의료, 프롬프트 공격, 스팸은 자동 게시하지 않고 감사 큐에 남긴다.
- [x] `threads_manage_mentions` 권한이 있으면 멘션도 같은 안전 정책으로 처리한다.
- [x] 모든 처리 결과는 기존 `agent_actions`에 멱등 키와 공급자 결과를 기록한다.
- [x] Threads 전용 OAuth 교환·장기 토큰 갱신이 공식 `graph.threads.net` 흐름을 사용한다.
- [x] 주제/발행/성과 동기화/댓글 루프가 문서화된 실제 주기로 예약된다.
- [x] 관리자 준비 상태 API가 토큰·권한·계정·스케줄·AI 준비 여부를 비밀값 없이 보고한다.
- [x] 관련 단위 테스트와 타입 검사가 통과한다.
- [x] 관련 SSOT: `docs/marketing-current-ssot.md`, `docs/threads-autopilot-runbook.md`

## In Scope

- 기존 자체 게시물의 모든 중첩 댓글과 계정 멘션
- LLM 기반 짧은 한국어 답변과 결정적 안전 정책
- Threads 공식 API의 2단계 답글 게시
- 기존 `agent_actions` 기반 감사·중복 방지
- Threads OAuth 교환/갱신 및 DB 토큰 우선 해석
- Vercel Cron 배선과 관리자용 읽기 전용 준비 상태

## Out Of Scope

- 타인 게시물에 키워드 검색으로 선제 댓글을 다는 아웃바운드 영업
- 댓글 속 외부 URL 본문 자동 수집
- 예약·결제·환불 상태를 댓글로 확정하거나 변경
- 욕설 댓글 자동 삭제/숨김

## Users And Risks

- Primary audience: 마케팅 운영자, Threads 고객
- Risk tier: Tier 3
- Sensitive surfaces: 외부 게시, OAuth 자격 증명, 고객 입력, AI 공급자, 감사 데이터

## Open Questions

- [x] 없음. 외부 댓글은 신뢰하지 않는 입력으로 취급하며, 사실 확인이 필요한 사안은 자동 응답 대신 운영 큐로 보낸다.
