# AI 에이전트 문서 자동화·하네스

상태: current
검증일: 2026-09-01
권위 영역: 문서 분류, 생성 문서, Spec 검사, CI 하네스

## 문서 계층

1. `AGENTS.md`: 공통 최소 계약과 작업 라우터
2. `CURRENT_STATUS.md`: 현재 권위의 짧은 색인
3. domain current SSOT: 도메인 계약
4. runbook·reference: 실행 절차와 상세 참고
5. roadmap·research: 계획과 외부 검토
6. audits·archive: 시점 증거와 대체된 기록

현재 정책 검색은 archive와 audits를 제외한다. 역사 문서는 삭제하지 않고 Git 이력과 archive manifest로 추적한다.

## Registry

`docs/document-registry.yml`은 문서 class, authority domain, owner, status, 검증일, 검토 주기, supersedes를 관리한다. class는 `current`, `runbook`, `reference`, `roadmap`, `research`, `historical`, `superseded`만 사용한다.

current·contract 후보는 명시적으로 등록한다. 다른 문서도 collection rule로 유효 메타데이터를 상속하지만, catch-all은 새 current 문서를 숨길 수 없다. 같은 authority domain에 활성 current 문서를 중복 등록하지 않는다.

## 생성 문서

[system inventory](generated/system-inventory.md)와 JSON은 코드에서 생성한다. 사람이 라우트·migration 수를 상태 문서에 복사하지 않는다.

```bash
npm run generate:system-inventory
npm run check:system-inventory
```

생성물은 결정적이어야 하며 비밀, 환경변수 값, 사용자 절대 경로를 포함하지 않는다.

## 스킬 원본

`.agents/skills`가 원본이고 `.claude/skills`는 호환 생성물이다.

```bash
npm run sync:agent-skills
npm run check:agent-skill-sync
npm run check:external-skill-sources
```

동기화 검사는 파일 집합과 바이트 내용을 모두 비교한다. 생성물을 직접 수정한 PR은 실패한다.

외부 Skill은 `.agents/skills`로 직접 복사하지 않는다. `config/agent-skill-sources.json`의 immutable provenance와 capability review를 통과하고 실제 여소남 과제 eval에서 안전성 회귀 없이 이긴 동작만 좁은 프로젝트 Skill로 재작성한다. catalog-wide install과 외부 installer 실행은 정상 경로가 아니다.

## Spec 수명주기

Tier 2·3의 active·blocked 작업은 `meta.yml`과 spec, plan, tasks, review를 가진다. completed 작업은 실제로 해석되는 verified commit, 존재하는 검증 증거, 미완료 필수 항목 0건이 필요하다. 요구사항·결정·증거·남은 부채를 `record.md` 하나로 압축할 수 있다.

새 Tier 2·3 패킷은 `surface_map_version: 1`과 `surface-map.v1.json`을 사용한다. CI는 선언된 활성 맵의 구조·write 중복·review write 금지를 검사하고, 작업자는 `--spec`, `--agent`, `--base`로 자신의 변경 경로를 검사한다.

문구 존재만으로 완전성을 판단하지 않는다. 구조, 상태, commit, evidence path, 체크박스를 검사한다.

## 단일 감사 진입점

```bash
npm run audit:doc-harness
npm run check:harness
```

감사는 registry, 링크·anchor, 감사 인덱스, Spec, 스킬 동기화, 지침 크기, 외부 출처 freshness, 비밀 패턴, 위험 자동 실행, 생성 inventory drift, 신규 위험 패턴을 검사한다.

JSON 인터페이스:

```text
schemaVersion
commit
baseline
generatedAt
summary
findings[]: id, severity, category, path, line, message, evidence, remediation, status
```

P0·P1과 current·harness 문서 위반은 baseline 예외 없이 차단한다. 기존 저위험 코드 패턴은 baseline에 기록하고 신규 위반만 차단한다.

## 평가 구분

Every previous failure becomes a reproducible dataset item when feasible. Never make the document the only fix: pair a policy correction with the narrowest fixture, test, eval, or executable guard that proves the failure cannot silently recur.

- `test:harness-contracts`: 30개 이상의 결정적 구조·정책 계약. 네트워크와 모델 비용 없이 PR에서 실행한다.
- `eval:harness:promptfoo`: 동일 계약을 고정된 Promptfoo 버전으로 재현한다.
- `eval:harness:live`: 실제 provider를 사용하는 선택형 행동 평가. 자격증명, 비용, 격리된 read-only 실행 환경이 있을 때만 실행한다.

Promptfoo는 루트 앱 의존성과 분리한 `tools/harness-evals` package lock의 정확한 버전을 사용한다. 2026-09-01 기준 `0.122.2`를 고정하되, 사용하지 않는 provider용 optional dependency는 설치하지 않고 현재 플랫폼의 잠긴 libSQL binding만 추가한다. CI는 설치 결과를 `audit:harness-evals`로 검사한다. 업그레이드는 최신 번호보다 설치 트리의 high/critical 0건과 30개 계약 재통과를 우선한다.

정적 파일 검사를 실제 Codex·Claude·Copilot 행동 결과로 보고하지 않는다. live 평가가 실행되지 않았으면 최종 보고에 명시한다.

## CI 분리

- PR `harness-contract`: registry, 내부 링크, Spec, 작업 surface, 외부 Skill provenance, 스킬 동기화, 지침 예산, 비밀, 신규 위험 패턴, inventory drift, deterministic contract eval
- 주간 전체 감사: 외부 링크, 출처 freshness, 전체 문서, 선택형 live eval

문서·비밀·권한 P0·P1에는 `continue-on-error`를 사용하지 않는다. 외부 사이트의 일시 장애는 advisory로 분리한다.

## 유지 원칙

- 절대 경로, 설치 여부, 개인 토큰 상태는 저장소 SSOT에 기록하지 않는다.
- 완료 보고서는 current SSOT에 섞지 않고 audits 또는 archive로 이동한다.
- 링크를 옮기면 호출 문서와 archive manifest를 함께 갱신한다.
- 날짜만 갱신해 freshness 검사를 우회하지 않는다. 코드·테스트·외부 근거를 다시 확인한다.
