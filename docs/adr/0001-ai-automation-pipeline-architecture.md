# ADR-0001: AI Automation Pipeline Architecture

**Status:** Accepted
**Date:** 2026-05-11
**Deciders:** 여소남 OS Team

## Context

여소남OS 플랫폼이 단일 개발자(사장님) + AI 협업 체제로 운영되고 있어, 다음 문제들이 발생:

1. **확장성 한계**: 수동 코드 리뷰, 수동 배포, 수동 테스트가 병목
2. **품질 회귀**: ESLint `ignoreDuringBuilds: true` 우회로 빌드 시 타입 에러 누락
3. **모니터링 공백**: 프로덕션 에러를 사용자가 먼저 발견
4. **배포 리스크**: main 머지 후 회귀 발견 시 롤백 비용 큼

목표: "1명이 20명 팀처럼 일할 수 있는" 자동화 인프라.

## Decision

**3단계 자동화 파이프라인** 채택:

### Stage 1: 로컬 검증 (30초)
- `.husky/pre-commit` → `lint-staged` (ESLint + Prettier + tsc)
- Claude Code `PostToolUse` 훅 → 파일 저장 즉시 `tsc --noEmit`

### Stage 2: PR 게이트 (15분 병렬)
- **15개 GitHub Actions 워크플로** 동시 실행:
  - type-safety, unit-tests, lighthouse-ci, bundle-monitor
  - api-security, db-query-performance, api-contract
  - performance-budget, ai-code-review
  - claude-pr-assistant (@claude 멘션 지원)

### Stage 3: 배포 + 모니터링 (자동)
- `semantic-release` → Conventional Commits 기반 버전 자동화
- Vercel 자동 배포 (main 머지 시)
- Sentry 에러 추적 + Slack 실시간 알림
- 15분 간격 헬스 체크 (continuous-monitoring.yml)
- 일일 비용 모니터링 (cost-monitoring.yml)
- 주간 DR 검증 (disaster-recovery.yml)

## Consequences

### Positive
- **70% 사이클 단축**: 2시간 → 30분
- **버그 조기 발견**: 프로덕션 → PR 단계 (95%+)
- **수동 작업 제거**: 배포, 버전 관리, 모니터링 자동화
- **품질 강제**: PR 통과 = 자동 품질 보증
- **확장 가능**: 팀 합류 시 즉시 동일 워크플로 적용

### Negative
- **초기 설정 복잡도**: 15개 워크플로 학습 필요
- **CI 시간/비용 증가**: GitHub Actions 분 소비량 증가
- **False positive 관리**: 분석기 정확도 지속 개선 필요
- **외부 의존성**: Sentry, Slack, Vercel 서비스 의존

### Neutral
- 기존 `.claude/` 시스템과 병행 운영
- CLAUDE.md 도메인 지식 레이어는 불변 유지

## Alternatives Considered

### Option A: gstack 풀 도입
- **Pros:** 23개 사전 정의된 커맨드, 즉시 사용 가능
- **Cons:** 우리 .claude/ 시스템이 이미 더 정교, `/setup-gbrain` memory 충돌
- **Why rejected:** 우리 인프라가 이미 초과 — 충돌 위험만 큼

### Option B: OpenHands 즉시 도입
- **Pros:** 완전 자율 에이전트, SWE-bench 53%
- **Cons:** Docker 기반, Zero-Hallucination Policy 위반 위험, 학습 곡선
- **Why rejected:** Stage 3로 연기 — CLAUDE.md 컨텍스트 주입 검증 필요

### Option C: 수동 운영 유지
- **Pros:** 단순함, 즉시 적용 가능
- **Cons:** 확장 불가, 회귀 비용 누적, 개발자 번아웃
- **Why rejected:** 장기 지속 불가능

## Implementation Notes

### Phase 1 (완료)
- [x] ESLint `ignoreDuringBuilds: false` 복원
- [x] Vercel Speed Insights 통합
- [x] PostToolUse tsc 훅 활성화
- [x] 15개 GitHub Actions 워크플로 생성
- [x] Sentry + Slack 통합
- [x] semantic-release 설정
- [x] 4개 E2E 테스트 스위트 (26개 시나리오)

### Phase 2 (진행 중)
- [x] claude-pr-assistant @claude 멘션 지원
- [x] DB 쿼리 성능 분석기
- [x] API 계약 검증기
- [x] 비용 모니터링
- [x] DR 검증
- [ ] aider 로컬 pair (Linux/macOS, Windows numpy 이슈)

### Phase 3 (계획)
- [ ] SWE-agent GitHub Issue → PR 자동화
- [ ] OpenHands 멀티 에이전트
- [ ] 병렬 세션 Conductor

## References

- [Stage 1 완료 보고서](../STAGE1_COMPLETE.md)
- [개발자 가이드](../DEVELOPER_GUIDE.md)
- [P3 고급 설정](../P3_ADVANCED_SETUP.md)
- [CLAUDE.md 하네스](../../.claude/CLAUDE.md)

---

**Status History:**
- 2026-05-11: Proposed
- 2026-05-11: Accepted
