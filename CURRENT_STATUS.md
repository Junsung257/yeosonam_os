# 여소남 OS 현재 상태와 권위 색인

> 검증 기준: 2026-09-02 · 현재 사실은 코드·테스트와 [생성 inventory](docs/generated/system-inventory.md)를 우선한다.

## 제품 경계

여소남 OS는 랜드사, 여소남 플랫폼, 여행사·고객을 잇는 B2B2C 여행 SaaS다. Production의 최종 권위는 상품·예약·고객·정산·공개 포인터와 각 도메인의 검증 경계에 있다.

이번 하네스 리팩터링은 문서·에이전트 설정·CI·조사 노드 안전성만 다룬다. Production DB 적용, 배포, 자동발행, 예약·결제·정산 변경은 범위 밖이다.

## 현재 권위

| 영역 | 현재 문서 |
|---|---|
| 제품 헌법 | [여소남 OS 헌법](docs/yeosonam-os-constitution.md) |
| 상품 등록·고객 공개 | [상품등록 SSOT](docs/product-registration-current-ssot.md) |
| 블로그 생성·발행 | [블로그 자동발행 계약](docs/blog-autopublish-contract.md) |
| AI 미디어 | [미디어 생성 SSOT](docs/media-generation-current-ssot.md) |
| 제휴 | [제휴 SSOT](docs/affiliate-current-ssot.md) |
| 정산 | [정산 SSOT](docs/settlement-current-ssot.md) |
| 마케팅 | [마케팅 SSOT](docs/marketing-current-ssot.md) |
| AI·자비스·RAG | [AI Ops SSOT](docs/ai-ops-current-ssot.md) |
| 조사 노드 | [Research Node SSOT](docs/research-node-current-ssot.md) |
| 에이전트 실행 | [Agent Workflow SSOT](docs/agent-workflow-current-ssot.md) |
| 문서·하네스 | [문서 자동화 계약](docs/ai-agent-doc-automation.md) |
| 문서 분류 | [Document registry](docs/document-registry.yml) |

라우트·페이지·migration·workflow·script 목록은 사람이 복사하지 않고 `npm run generate:system-inventory`로 생성한다.

## 핵심 안전 상태

- 상품 공개는 해당 도메인의 publication gate와 불변 snapshot/pointer를 우회하지 않는다.
- 블로그 생성, 편집 검수, 공개, 이미지 교체, 색인은 서로 분리된 계약이다.
- 구독형 이미지는 로그인된 Codex built-in ImageGen만 사용한다. Images API 키, Pexels 정상 fallback, 직접 Supabase 쓰기는 금지한다.
- Research Node는 review-only signal만 intake API로 제출한다. Production DB 키, 발행·예약·결제 권한을 갖지 않는다.
- Research intake는 인증 후 분산 rate-limit 백엔드가 없으면 503으로 실패-폐쇄한다.
- 외부 조사 결과는 시장 반응·주제 후보이며 가격·일정·취소규정의 최종 사실 근거가 아니다.
- Supabase MCP는 프로젝트 범위·읽기 전용·최소 feature group이 기본이다. 계정 범위 플러그인은 기본 비활성으로 둔다.
- 문서 감사와 에이전트 설정은 Production DB나 배포를 자동 실행하지 않는다.
- 블로그 모델 비교는 DeepSeek champion을 유지하는 비용 승인형 advisory lane이다. NVIDIA NIM과 고정 OpenRouter 모델만 3건 smoke 후 V5 33건을 두 번 평가할 수 있으며, 결과는 production provider나 DB enum을 자동 변경하지 않는다.
- Vercel 정기 실행은 검증된 블로그 핵심 8개와 만료된 승인·AI 작업을 정리하는 일 1회 `agent-housekeeping`만 allowlist로 유지한다. 상품등록 backfill·watchdog와 비활성 기능은 API 코드를 보존하되 상시 스케줄에 선등록하지 않는다.

## 운영 검증

```bash
npm run check:harness
npm run audit:automation-runtime:ci
npm run audit:llm-telemetry:ci
npm run type-check
```

실제 운영 상태는 각 명령의 현재 결과와 도메인 SSOT를 함께 확인한다. 과거의 장문 상태 로그는 [archive snapshot](docs/archive/status/2026-09-01-current-status-pre-refactor.md)으로 보존했다.
