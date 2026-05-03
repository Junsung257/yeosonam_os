# AGENTS.md — 여소남 OS (AI 에이전트 공통 진입점)

> **서비스 한 줄:** 랜드사 → 플랫폼(여소남) → 여행사/고객을 잇는 **B2B2C 여행 SaaS**. 멀티 테넌시·예약 상태 머신·제휴/정산·AI(자비스·QA)가 핵심이다.

이 파일은 **항상 짧게 유지**한다. 상세 레시피·유틸 카탈로그·프로세스 완수 규칙은 **`.claude/CLAUDE.md`**에 있다.

---

## 1. 작업 전에 무엇을 읽을지

| 작업 성격 | 먼저 Read (필요한 구간만) |
|-----------|---------------------------|
| **도메인·DB·RLS·제휴·PII·학습 데이터·자비스** | `CURRENT_STATUS.md`, 아래 **§docs/ 주제별** 표에서 파일 고른 뒤 필요한 구간만 Read, `.claude/CLAUDE.md` 해당 절 |
| **상품 등록·A4/모바일 렌더·관광지** | `.claude/CLAUDE.md` §도메인별 강제 진입점 + `.claude/commands/*.md` |
| **오타·import 한 줄·사용자가 지정한 단일 파일 기계적 수정** | 생략 가능 (프로젝트 규칙은 `.cursor/rules` 참고) |

사용자가 「CLAUDE 읽고」「상태 확인」이라고 하면 해당 턴에서 위 문서를 **실제로 연 뒤** 진행한다.

---

## 2. 단일 정보 소스 (SSOT) 원칙

- **사실·정책·스키마 요약의 최신본:** 루트 `CURRENT_STATUS.md` (날짜 확인).
- **구현 레시피·안티패턴·명령 체크리스트:** `.claude/CLAUDE.md`.
- **대화 톤·컨텍스트 읽기 시점:** `.cursor/rules/` (`yeosonam-context.mdc`, `yeosonam-communication-ko.mdc`).

채팅 **메모리**에만 두는 도메인 지식은 오래된 오답이 될 수 있으므로, 반복되는 결정은 **이 레포의 Markdown으로 옮기고 PR로 갱신**하는 것을 우선한다.

### docs/ 주제별 (빠른 찾기)

| 주제 | 파일 |
|------|------|
| 제휴 추적·쿠키·코브랜딩 | `docs/affiliate-attribution.md` |
| 블로그 운영 런북 | `docs/blog-system-runbook.md` |
| 배포 전 체크리스트 | `docs/deploy-checklist.md` |
| 환경 변수 레퍼런스 | `docs/env-variables-reference.md` |
| 자유여행 100 시나리오 스펙 | `docs/free-travel-100-scenarios-spec.md` |
| 자유여행 AI 플래너 운영 | `docs/free-travel-planner-runbook.md` |
| 자비스 오케스트레이션 | `docs/jarvis-orchestration.md` |
| 플랫폼 AI·학습 로드맵 | `docs/platform-ai-roadmap.md` |
| Solapi 리뷰 요청 템플릿 | `docs/solapi-review-template-guide.md` |

*새 문서를 `docs/`에 추가하면 이 표에 한 줄 반영할 것.*

---

## 3. 레포 지도 (요약)

| 경로 | 역할 |
|------|------|
| `src/app/` | Next.js App Router (고객·어드민·API) |
| `src/lib/` | 비즈니스 로직·연동 (UI에 로직 넣지 말 것) |
| `supabase/migrations/` | DB 스키마 변경 이력 |
| `docs/` | 주제별 심화 문서 — **위 §docs/ 주제별 표** |
| `db/` | 감사·마이그레이션 스크립트, `FIELD_POLICY.md`, `error-registry.md` |

---

## 4. 에코시스템별 파일

| 도구 | 파일 |
|------|------|
| **Cursor / 범용 CLI 에이전트** | 이 파일(`AGENTS.md`) + `.cursor/rules/*.mdc` |
| **Claude Code / 심층 하네스** | `.claude/CLAUDE.md` |
| **GitHub Copilot (IDE·리뷰)** | `.github/copilot-instructions.md` |

---

## 5. 로컬 개발 (최소)

- 의존성: `npm install`
- 개발 서버: `npm run dev`
- 환경 변수 요약: `docs/env-variables-reference.md`

---

*갱신 시: `CURRENT_STATUS.md` 날짜·메뉴/테이블과 충돌이 없는지 함께 점검할 것.*
