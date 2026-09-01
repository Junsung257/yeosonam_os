# AGENTS.md — 여소남 OS 공통 에이전트 진입점

> 랜드사 → 여소남 플랫폼 → 여행사·고객을 잇는 B2B2C 여행 SaaS다. 멀티 테넌시, 예약 상태, 제휴·정산, 공개 콘텐츠, AI 감사 가능성이 핵심이다.

이 파일은 모든 에이전트가 공유하는 최소 계약이다. 세부 구현은 관련 SSOT와 실제 코드·테스트에서 확인한다. 도구별 파일은 이 계약을 복제하지 않고 차이만 설명한다.

## 1. 권위와 읽기 순서

1. 사용자 요청과 현재 코드·테스트·스키마
2. 해당 도메인의 current SSOT 또는 계약
3. [CURRENT_STATUS.md](CURRENT_STATUS.md)의 권위 색인
4. 경로별 규칙과 운영 runbook
5. 감사·연구·archive 기록

감사와 archive는 증거이지 현재 정책이 아니다. 필요한 파일만 읽고 작은 수정 때문에 모든 규칙과 문서를 일괄 로드하지 않는다.

| 작업 | 먼저 확인 |
|---|---|
| 상품 등록·A4·모바일·관광지 | [상품등록 SSOT](docs/product-registration-current-ssot.md), 필요 시 `.agents/skills/register/SKILL.md` |
| 블로그·이미지·SEO·색인 | [블로그 계약](docs/blog-autopublish-contract.md), [미디어 SSOT](docs/media-generation-current-ssot.md) |
| 제휴·추천·커미션 | [제휴 SSOT](docs/affiliate-current-ssot.md) |
| 결제·ledger·정산·환불 | [정산 SSOT](docs/settlement-current-ssot.md) |
| 마케팅·광고·외부 발행 | [마케팅 SSOT](docs/marketing-current-ssot.md) |
| AI·자비스·RAG·프롬프트 | [AI Ops SSOT](docs/ai-ops-current-ssot.md) |
| 외부 조사·웹 수집 | [Research Node SSOT](docs/research-node-current-ssot.md) |
| 에이전트·문서·하네스 | [Agent Workflow SSOT](docs/agent-workflow-current-ssot.md), [문서 자동화 계약](docs/ai-agent-doc-automation.md) |
| DB·RLS·마이그레이션 | [CURRENT_STATUS.md](CURRENT_STATUS.md), `.cursor/rules/db-migration-policy.mdc`, `db/FIELD_POLICY.md` |
| API 응답·인증 | `.cursor/rules/api-response-format.mdc`, 인접 route와 test |
| Git·PR·배포 | [Git 핸드오프](docs/git-commit-handoff.md) |

## 2. 변경 계약

- 설명·감사 요청은 읽기 전용으로 끝낸다. 구현 요청만 파일이나 외부 상태를 바꾼다.
- 실제 호출자와 기존 검증 경계를 먼저 찾고 가장 작은 공통 경계에서 수정한다.
- UI에 비즈니스 로직을 새로 넣지 않는다. 계산·파싱·권한 판단은 `src/lib` 또는 기존 도메인 계층을 따른다.
- 스키마 변경은 새 migration과 검증을 남긴다. Production DB 적용은 별도 승인 없이는 하지 않는다.
- 고객·예약·정산·PII·광고비·외부 발행·자격증명 변경은 대상과 영향 범위를 확인하고 승인 경계를 지킨다.
- 자동화 성공 문구가 아니라 테스트, API·DB 확인, 브라우저 증거, 감사 결과 중 하나 이상으로 완료를 증명한다.
- 관련 없는 사용자 변경은 보존한다. 폐기·강제푸시·대규모 되돌리기는 명시 승인 없이는 하지 않는다.

작업 규모는 [Agent Workflow SSOT](docs/agent-workflow-current-ssot.md)의 Tier 0~3을 따른다. 활성 Tier 2·3만 Spec 패킷을 요구한다.

## 3. 문서와 스킬

- 문서 분류와 검증 기한은 [문서 registry](docs/document-registry.yml)가 관리한다.
- 현재 사실 색인은 [CURRENT_STATUS.md](CURRENT_STATUS.md), 기계적 목록은 [generated inventory](docs/generated/system-inventory.md)가 담당한다.
- 일회성 증거는 `docs/audits`, 대체된 문서는 `docs/archive`에 둔다.
- 스킬 원본은 `.agents/skills`다. `.claude/skills`는 생성된 호환 사본이며 직접 수정하지 않는다.
- 반복 오류는 테스트·fixture·eval·SSOT·error registry 중 가장 작은 재발 방지 장치로 남긴다.

검증 명령:

```bash
npm run check:harness
npm run check:agent-workflow:ci
npm run check:doc-automation:ci
```

## 4. 도구별 어댑터

- Claude Code: `.claude/CLAUDE.md`
- Cursor: `.cursor/rules`
- GitHub Copilot: `.github/copilot-instructions.md`
- 공통 스킬: `.agents/skills`

외부 에이전트 런타임·MCP·플러그인을 정상 작업의 전제로 삼지 않는다. 일반 도구 조언과 여소남 SSOT가 충돌하면 코드 증거와 도메인 SSOT를 우선하고 충돌을 보고한다.

## 5. 로컬 기본 명령

- 설치: `npm install`
- 개발: `npm run dev`
- 단위 테스트: `npm test`
- 타입 검사: `npm run type-check`
- 환경변수 계약: [환경변수 레퍼런스](docs/env-variables-reference.md)
