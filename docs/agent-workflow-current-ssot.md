# 에이전트 워크플로우 현재 SSOT

상태: current
검증일: 2026-09-01
권위 영역: 에이전트 작업 분류, 승인 경계, Spec 수명주기, 완료 증거

## 목적

에이전트는 필요한 컨텍스트만 단계적으로 읽고 위험에 비례해 계획·검증·승인을 늘린다. 특정 런타임, MCP, 서브에이전트 수, 문서 파일 수를 성공 조건으로 삼지 않는다.

## 작업 Tier

| Tier | 예시 | 필수 기록 |
|---|---|---|
| 0 | 오타, 한 줄 import, 지정 파일의 기계적 수정 | 인접 확인과 좁은 검증 |
| 1 | 단일 기능·문서·테스트의 국소 변경 | 짧은 계획과 관련 검증 |
| 2 | 여러 모듈, 권한 경계, 신규 파이프라인 | 활성 Spec 패킷과 단계별 검증 |
| 3 | DB·예약·정산·PII·외부 발행·대규모 구조 변경 | Tier 2 + 명시적 승인점 + rollback 증거 |

활성 Tier 2·3은 `meta.yml`, `spec.md`, `plan.md`, `tasks.md`, `review.md`를 요구한다. 완료 작업은 검증 근거와 남은 부채를 `record.md`에 보존할 수 있으며 빈 템플릿을 영구 유지하지 않는다.

새 Tier 2·3 작업은 `surface_map_version: 1`과 `surface-map.v1.json`을 함께 둔다. 맵은 작업 안에서만 유효하며 에이전트별 write, read-only, forbidden 경로를 선언한다. 서로 다른 에이전트의 write 범위는 겹칠 수 없고 review/audit 역할은 write 범위를 가질 수 없다. 기존 활성 Spec에는 근거 없는 소유권을 소급 생성하지 않고 다음 재계획 때 도입한다.

## 표준 흐름

1. 결과, 비범위, 위험 경계를 한 문장으로 고정한다.
2. `AGENTS.md`에서 해당 도메인 SSOT를 선택한다.
3. 호출자, 공통 로직, 테스트, 스키마를 좁게 탐색한다.
4. 변경 전 실패 조건과 검증 방법을 정한다.
5. 기존 사용자 변경을 보존하며 가장 작은 공통 경계에서 구현한다.
6. 좁은 테스트에서 넓은 테스트 순서로 검증한다.
7. 사실, 추론, 미검증 항목을 분리해 인계한다.

여러 에이전트나 worktree가 쓰는 Tier 2·3 작업은 커밋 전 `npm run check:agent-surfaces -- --spec <spec-id> --agent <agent-id> --base <base-ref>`로 tracked, staged, unstaged, untracked 경로를 함께 검사한다.

외부 Skill·에이전트 카탈로그는 challenger 자료다. 자동 설치기나 전체 카탈로그를 실행하지 않고 `config/agent-skill-sources.json`에 immutable source, hash, license, 명령·Hook·비밀·네트워크 권한, eval, 상태를 기록한다. 승인된 동작만 여소남 전용 Skill·테스트·체크리스트로 다시 작성한다.

대규모 작업은 독립된 조사와 구현을 병렬화할 수 있다. 서브에이전트가 사용자 지침이나 스킬을 대신 해석하지 않으며 최종 통합 책임은 주 에이전트에 있다.

## 승인과 중단 경계

다음은 사용자 요청에 명시되거나 별도 승인을 받은 범위를 넘어 자동 실행하지 않는다.

- Production DB migration·수정·재색인
- Production 배포, 외부 발행, 광고비 집행
- 예약·결제·환불·정산·고객 알림 변경
- 토큰·키 폐기와 계정 권한 변경
- 강제 push, 광범위 삭제, 사용자 변경 폐기

읽기·감사 요청은 외부 상태를 변경하지 않는다. 명령이 성공해도 실제 결과 증거가 없으면 완료로 판단하지 않는다.

## Spec 수명주기

`meta.yml`은 `tier`, `status`, `owner`, `verified_commit`, `verification`을 가진다.

- `active`·`blocked` Tier 2·3은 전체 패킷을 유지한다.
- `completed`는 검증 commit이 실제 Git commit으로 해석되고, 검증 근거 파일이 존재하며, 필수 미완료 체크박스가 없을 때만 허용한다.
- 완료 패킷을 `record.md`로 압축해도 요구사항, 결정, 검증, 남은 advisory는 삭제하지 않는다.
- `blocked`는 동일 차단 조건과 필요한 다음 권한을 기록한다.

## 조사 노드 경계

Agent-Reach·OpenCLI 같은 로그인 세션 조사 도구는 Production 핵심 엔진이 아니다. 별도 Research Node는 공개 원문과 시장 반응을 수집하고 review-only intake만 사용한다.

Research Node에는 Production 서비스 역할 키, 예약·결제·발행 권한, 고객 PII 접근을 주지 않는다. 수집기는 버전·출처·시각·해시를 남기고 DNS·redirect·빈 본문·로그인 오류를 실패-폐쇄한다.

## 품질 평가

- deterministic contract eval: 지침·설정·문서 구조가 정책을 표현하는지 CI에서 검사
- optional live behavior eval: 실제 모델/provider가 읽기·승인·비밀·조사 경계를 지키는지 자격증명이 있는 격리 환경에서 검사
- LLM judge: 표현 품질처럼 결정 규칙으로 검사하기 어려운 항목에만 사용

정적 문자열 검사를 실제 에이전트 행동 검증으로 부르지 않는다. OTel 기본 필드는 모델, 지연, 토큰, 결과 코드로 제한하고 프롬프트·도구 인자·PII는 기본 수집하지 않는다.

## 완료 계약

- 변경 파일과 사용자 기존 변경을 구분한다.
- 실행한 검증과 미실행 검증을 구분한다.
- DB·배포·외부 계정처럼 남은 수동 단계는 숨기지 않는다.
- 반복될 결정은 current SSOT, 테스트, eval, error registry 중 가장 작은 권위에 반영한다.
