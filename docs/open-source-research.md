# 오픈소스·논문·베스트사례 조사 결과 (2026-05-26)

> 여소남 OS 마케팅 자동화 시스템에 적용 가능한 오픈소스 프로젝트, 학술 논문, 산업 베스트사례 종합.

---

## 1. 핵심 요약

| 영역 | 우리 상태 | 가져올 것 | 우선순위 |
|------|----------|-----------|---------|
| 멀티모델 AI 오케스트레이션 | Gemini 2.5 Flash 단일 사용 | 태스크별 최적 모델 라우팅 | P1 |
| SEO 품질 게이트 | 9-Gate (자체 구현) | 복합 점수(quality+AI+SEO), auto-unpublish | P2 |
| AEO (Answer Engine Optimization) | 미구현 | Answer Intent Map, brand-facts.json | P1 |
| 다중 플랫폼 배포 | 네이버 블로그 전용 | Threads/Instagram/X 동시 배포 파이프라인 | P1 |
| n8n 워크플로우 자동화 | 미사용 | DMO 운영 자동화, 리뷰 모니터링, 스케줄링 | P2 |
| 학술 서베이 자동 생성 | 수동 | 멀티에이전트 리서치 → 리뷰 → 생성 파이프라인 | P3 |

---

## 2. 오픈소스 프로젝트 상세

### 2.1 콘텐츠 생성 파이프라인

#### [flyweel-agentic-seo-aeo-engine](https://github.com/openairlabs/flyweel-agentic-seo-aeo-engine) ⭐
**무엇인가**: 멀티모델 AI 오케스트레이션 기반 SEO/AEO 블로그 생성기.

**우리가 가져올 것**:
- **병렬 리서치** (SERP + Reddit + Quora 동시 마이닝) — 우리는 지금 SERP만 분석
- **멀티모델 오케스트레이션** — 태스크별 최적 모델 선택 (리서치=Gemini, 생성=Claude 등)
- **Astro MDX + JSON-LD 스키마 출력** — 우리도 schema.org 마크업 추가 필요
- **GSC cannibalization 체크** — 같은 주제 중복 글 방지
- **6가지 콘텐츠 스타일** — 상황별 템플릿 다양화

**적용 난이도**: 중간 (아키텍처 참조, 코드 직접 가져오기는 어려움)

#### [nometria/blog-pipeline](https://github.com/nometria/blog-pipeline) ⭐
**무엇인가**: 7-pass(7단계) 파이프라인 블로그 생성기. 멀티LLM, Supabase 연동, 품질 게이트.

**우리가 가져올 것**:
- **복합 감사 게이트**: quality 60% + AI detection 20% + SEO 20% — 우리는 boolean pass/fail만 있음
- **Humanizer**: AI 글투 제거 엔진 (50+ 금지어, 수동태 교정, 문단 다양성) — 우리는 gate만 있고 자동 교정 없음
- **AI 탐지 점수기**: 순수 Python 휴리스틱 (0.0=인간, 1.0=AI) — 우리는 ai_readability 게이트만 있음
- **auto-unpublish**: 품질 낮은 글 자동 발행 취소/회수 — 우리는 그냥 큐에 남김

**적용 난이도**: 낮음 (로직만 참조, Python → TypeScript 포팅)

#### [MiCA OSS Marketing Automation](https://github.com/RenegadeRocks/MiCA-OSS-Marketing-Automation-System)
**무엇인가**: 비즈니스 설명 1회로 이메일+WhatsApp+Instagram+AI 아바타 영상 5분 만에 생성.

**우리가 가져올 것**:
- **DoodleMap 온보딩**: 상품 설명 → 전략 → 자산 생성 원스톱
- **n8n 연동 파이프라인**: 실제 발행/배포를 n8n webhook으로 위임하는 패턴
- **HeyGen 아바타 영상**: AI 아바타가 설명하는 영상 생성

**적용 난이도**: 중간 (n8n 인프라 필요)

#### [dmo-claw](https://github.com/freddy-schuetz/dmo-claw) ⭐
**무엇인가**: DMO(관광청/관광 조직) 전용 AI 에이전트 (n8n 기반).

**우리가 가져올 것**:
- **리뷰 모니터링**: Google 리뷰 자동 수집 → ★3 이하 알림
- **인스타그램 포스팅**: Graph API + 자동 토큰 갱신 + 스케줄링
- **날씨 리포트 자동 생성** (우리는 이미 있음, alpine 대신 여행지 날씨)
- **전문가 에이전트 위임**: Research Expert / Content Creator / Data Analyst
- **주간·일일 브리핑**: 자동 리포트 생성

**적용 난이도**: 낮음 (n8n 사용 가능, 개념만 차용)

#### [pseo-quality-gate](https://github.com/piyushbhattadforapps/pseo-quality-gate) ⭐
**무엇인가**: 프리미엄 pSEO 콘텐츠용 13개 하드 게이트 (제로 의존성).

**우리가 가져올 것**:
- **13개 하드 게이트** 중 우리가 없는 것:
  - readability(읽기 수준): 한국어 Flesch-Kincaid 대안
  - template_compliance(템플릿 준수율)
  - entity_coverage(개체 커버리지)
  - citation_density(인용 밀도)
  - originality_score(독창성 점수)
- **내용물-생성기 독립성**: 어떤 생성기(generator)든 출력만 게이트 통과 여부 확인

**적용 난이도**: 매우 낮음 (JSON validator라서 바로 포팅 가능)

#### [GEOFlow](https://github.com/yaojingang/geoflow)
**무엇인가**: GEO(생성형 엔진 최적화) 오픈소스 콘텐츠 시스템. PostgreSQL+pgvector+RAG.

**우리가 가져올 것**:
- **GEO 최적화**: AI 검색 엔진(ChatGPT, Perplexity 등)에서 잘 발견되도록 최적화
- **지식 베이스 + 임베딩**: 전체 콘텐츠 관리 + 벡터 검색 (우리는 pgvector 사용 중)
- **다국어 지원**: 중/영/일/서/러/포 — 우린 한국어 전용
- **Docker Compose 원클릭 배포**

**적용 난이도**: 높음 (전체 시스템 도입)

#### [RankForge](https://github.com/Rishabh1925/RankForge)
**무엇인가**: 멀티에이전트 콘텐츠 엔진 (Researcher → Writer → Editor), 3분 만에 SEO 글 생성.

**우리가 가져올 것**:
- **멀티에이전트 파이프라인**: Researcher(조사) → Writer(작성) → Editor(편집)
- **20+ SEO 메트릭 점수화**
- **Naturalness Analysis**: AI 탐지 위험 측정, 문장 다양성, 어휘 풍부도

**적용 난이도**: 중간

---

## 3. 학술 논문 (서베이 자동 생성)

### 3.1 [SurveyX](https://arxiv.org/abs/2502.14776) (2025)
**핵심 아이디어**: 2단계(준비→생성) + AttributeTree 전처리 + 온라인 레퍼런스 검색 + 재폴리싱.

**우리가 배울 점**:
- **AttributeTree**: 콘텐츠 구조를 계층적으로 정의하는 방법
- **RAG 기반 재작성**: 생성 후 검색 결과로 품질 개선
- **표/그래프 자동 생성**: 정량 데이터 시각화

### 3.2 [SurveyGen-I](https://aclanthology.org/2025.ijcnlp-long.193/) (ACL 2025)
**핵심 아이디어**: Coarse-to-fine 검색 + 적응형 플래닝(PlanEvo) + 메모리 가이드 생성(CaW-Memory).

**우리가 배울 점**:
- **PlanEvo**: 글을 쓰면서 계획(목차)을 동적으로 수정
- **메모리 메커니즘**: 이전에 쓴 섹션을 기억해 일관성 유지
- **subsection-level 검색**: 문맥 부족 시 추가 검색

### 3.3 [Agentic AutoSurvey](https://arxiv.org/pdf/2509.18661) (2025)
**핵심 아이디어**: 4개 전담 에이전트(Paper Search → Topic Mining → Writer → Evaluator) 협업.

**우리가 배울 점**:
- **멀티에이전트 협업**: 각자 전문화된 역할을 가진 AI 에이전트가 협력
- **품질 평가자(Quality Evaluator)**: 생성 결과를 독립적으로 평가
- **75-443개 논문 처리**: 대규모 콘텐츠 파이프라인 참고

### 3.4 [LiRA: Literature Review Agents](https://arxiv.org/abs/2510.05138) (2025)
**핵심 아이디어**: Outlining → Subsection Writing → Editing → Reviewing 4단계 워크플로우.

**우리가 배울 점**:
- **Outliner → Writer → Editor → Reviewer 4단계**: 우리는 generateFromTopic 한 방이 전부
- **환각(hallucination) 저감**: 자동 생성 콘텐츠의 신뢰성 향상
- **가독성(Readability) 중점**: 우리는 기본 Flesch-Kincaid만 있음

---

## 4. 즉시 적용 가능한 개선 사항

### A. 복합 품질 점수 도입 (P1)
**현재**: 9개 게이트 boolean pass/fail, 하나라도 fail이면 발행 실패.

```typescript
// 현재
const qaPassed = gates.every(g => g.passed);

// 제안: 복합 점수
const compositeScore = qualityWeight * 0.6 + aiDetectionWeight * 0.2 + seoWeight * 0.2;
if (compositeScore >= 0.7) {
  // 발행 (critical fail만 차단)
} else if (compositeScore >= 0.5) {
  // 재시도
} else {
  // 실패
}
```

**효과**: 약간 모자란 글도 발행 기회 부여, 누적 품질 모니터링 가능.

### B. AEO 인프라 구축 (P1)
**현재**: SEO는 있지만 AEO(Answer Engine Optimization)는 전무.

**제안**:
1. **Answer Intent Map**: 여행 관련 구매 의도 질문 50개 + AI가 추천하는 브랜드 매핑
2. **brand-facts.json**: `/.well-known/brand-facts.json`에 여소남 서비스 설명 JSON-LD
3. **Answer Hub 페이지**: "○○여행 준비물", "△△비자" 등 핵심 질문에 대한 장문 가이드

### C. 멀티모델 라우팅 (P1)
**현재**: 모든 생성 태스크에 Gemini 2.5 Flash 사용.

**제안**:
| 태스크 | 권장 모델 | 이유 |
|--------|----------|------|
| SERP 분석 | Gemini 2.5 Flash | 빠름, 충분한 품질 |
| 장문 pillar 생성 | Claude Sonnet 4 | 더 긴 컨텍스트, 구조화 능력 |
| 상품 리뷰 | GPT-4o mini | 마케팅 톤, 저렴 |
| 품질 게이트 | 모든 모델 공용 | 모델 불가지론 유지 |
| 이미지 프롬프트 | Gemini 2.5 Flash | 충분함 |

### D. Humanizer 도입 (P2)
**현재**: AI 글투 감지만 하고 교정은 안 함.

**제안**: 생성 후 AI 문체 감지 → 금지어/수동태/일괄적 문장 구조 자동 교정 pass 추가.

---

## 5. 추천 로드맵

| 순서 | 작업 | 예상 공수 | 영향 |
|------|------|----------|------|
| 1 | 복합 품질 점수 도입 (A) | 2일 | 발행률 20%↑ |
| 2 | AEO 인프라 (B) | 3일 | AI 검색 트래픽 |
| 3 | 멀티모델 라우팅 (C) | 2일 | 콘텐츠 품질↑ |
| 4 | pseo-quality-gate 추가 게이트 (4개) | 1일 | 품질 정밀도↑ |
| 5 | Humanizer (D) | 3일 | AI 탐지 회피 |
| 6 | Threads/Instagram 동시 발행 | 3일 | 채널 다각화 |
| 7 | 병렬 리서치 도입 | 2일 | 생성 속도↑ |

---
## 6. 실제 포팅 완료 — 검증된 오픈소스 코드 반영

위 조사 결과 중 **실제로 코드로 포팅한 것들**:

### ✅ TrendStyle 엔진 (stylometric-transfer + agent-style-transfer)

| 요소 | 오픈소스 출처 | 우리 포팅 |
|------|-------------|----------|
| JSON Style Fingerprint | [stylometric-transfer](https://github.com/ngpepin/stylometric-transfer) (⭐) `prompts.json` | `src/lib/trend-style-engine.ts` — `StyleFingerprint` schema |
| Fingerprint → LLM prompt | stylometric-transfer `derived_instructions.rewrite_prompt` | `fingerprintToPromptBlock()` — fingerprint → 자연어 스타일 가이드 |
| Multi-agent style inference | [agent-style-transfer](https://github.com/ArcadeAI/agent-style-transfer) (⭐) `agent.py` | `selectFingerprint()` — platform + trendKeywords 기반 동적 선택 |
| Trend-driven adjustment | stylometric-transfer `trend_affinity` 개념 | `adjustFingerprintForTrends()` — 트렌드 키워드로 tone 조정 |
| Statistical measurements | stylometric-transfer `make/measurement` | `extractStyleSignal()` — 문장 길이/감정/후크 패턴 추출 |
| 성과 기반 피드백 루프 | agent-style-transfer `evaluation.py` | `learnThreadsTrends()` → `appendVoiceSample()` |

**적용 파일**:
- `src/lib/trend-style-engine.ts` — 엔진 코어 (fingerprint 저장소 + 선택/조정/프롬프트 변환)
- `src/lib/threads-trend-learner.ts` — 트렌드 스타일 학습 파이프라인
- `src/lib/content-pipeline/agents/threads-post.ts` — TrendStyle 연결 (수정)
- `src/app/api/cron/threads-trend-miner/route.ts` — 크론에 Trend Learner 통합
- `src/app/api/content/threads-post/route.ts` — API에 trendKeywords/angleType 파라미터 추가
- `db/scripts/seed-brand-voice-fingerprint.ts` — 초기 fingerprint DB 시드

**효과**:
1. Threads 포스트 생성 시 트렌드 키워드 기반 문체 자동 변환
2. 가성비/감성/럭셔리/모험 AngleType별 문체 분기
3. 기존 brand-voice DB 학습 루프와 연결
4. 향후 블로그 generatePillar에도 동일 엔진 확장 가능

---

*조사일: 2026-05-26 | 다음 갱신: 2026-08-26 (3개월)*
