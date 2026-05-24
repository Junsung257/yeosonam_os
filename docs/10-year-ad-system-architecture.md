# 여소남 10년 광고 시스템 아키텍처

> v1.0 — 2026-05-24
> 설계 원칙: 10년을 내다본 확장성, 데이터 기반 의사결정, AI 자율 최적화, 멀티채널 통합

---

## 0. 핵심 철학

이 아키텍처는 **"데이터가 쌓일수록 스스로 진화하는 시스템"**을 목표로 합니다.

```
Year 1-2: 수동/반자동 → 데이터 수집기 확보
Year 3-5: 데이터 기반 자동화 → 규칙 기반 최적화
Year 6-8: AI 기반 자율 운영 → 예측/제안
Year 9-10: 완전 자율 광고 시스템 → 전략 수립까지 AI
```

---

## 1. 전체 시스템 아키텍처 (10년 목표)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        🧠 AI Orchestrator                           │
│  (전략 수립 → 채널 할당 → 예산 분배 → 성과 예측 → 자율 실행)         │
└──────────┬────────────────────────────────────────────────┬─────────┘
           │                                                │
           ▼                                                ▼
┌──────────────────────┐                    ┌──────────────────────────┐
│   📊 Data Lake       │                    │   ⚙️ Execution Engine     │
│                      │                    │                          │
│  - Keyword DB        │◄──────────────────►│  - Google Ads API        │
│  - Performance DB    │    학습/데이터     │  - Meta API              │
│  - Auction DB        │    양방향          │  - Naver SearchAd API    │
│  - Competitor DB     │                    │  - Twitter/X API         │
│  - Seasonality DB    │                    │  - Naver Cafe API        │
│  - Conversion DB     │                    │  - Kakao/톡톡            │
│  - Budget History    │                    │  - 블로그 자동 포스팅     │
└──────────────────────┘                    └──────────────────────────┘
           │                                                │
           ▼                                                ▼
┌──────────────────────┐                    ┌──────────────────────────┐
│   📈 Analytics Layer  │                    │   🔄 Feedback Loop       │
│                      │                    │                          │
│  - 실시간 대시보드    │                    │  - Search Terms 자동 수집 │
│  - 월간/분기 리포트  │                    │  - Negative KW 자동 추가  │
│  - 채널별 기여도     │                    │  - 입찰가 Daily 최적화    │
│  - 예측 모델링       │                    │  - 크리에이티브 A/B      │
│  - 비용/ROAS 추적    │                    │  - 예산 재할당           │
└──────────────────────┘                    └──────────────────────────┘
```

---

## 2. 데이터 레이어 상세 설계

### 2.1 핵심 데이터 엔티티

```
keyword_data
├── id: UUID (PK)
├── tenant_id: UUID
├── keyword_text: TEXT
├── tier: 'core' | 'mid' | 'longtail' | 'micro'
├── match_type: 'exact' | 'phrase' | 'broad'
├── destination: TEXT
├── category: TEXT
├── initial_bid: INTEGER (원)
├── current_bid: INTEGER (원)
├── min_bid: INTEGER
├── max_bid: INTEGER
├── platform: 'google' | 'naver' | 'meta' | 'all'
├── status: 'active' | 'paused' | 'archived'
├── created_at: TIMESTAMPTZ
└── updated_at: TIMESTAMPTZ

keyword_performance_daily
├── id: UUID (PK)
├── keyword_id: UUID (FK → keyword_data)
├── date: DATE
├── impressions: INTEGER
├── clicks: INTEGER
├── ctr: DECIMAL(5,4)
├── avg_cpc: INTEGER (원)
├── cost: INTEGER (원)
├── conversions: DECIMAL(10,4)
├── conversion_value: DECIMAL(12,2)
├── roas: DECIMAL(10,4)
├── avg_position: DECIMAL(3,1)
├── search_impression_share: DECIMAL(5,4)
├── platform: 'google' | 'naver'
└── PRIMARY KEY (keyword_id, date, platform)

keyword_search_terms
├── id: UUID (PK)
├── keyword_id: UUID (FK)
├── search_term: TEXT
├── match_type: 'exact' | 'phrase' | 'broad'
├── impressions: INTEGER
├── clicks: INTEGER
├── ctr: DECIMAL(5,4)
├── cost: INTEGER (원)
├── conversions: DECIMAL(10,4)
├── added_as_negative: BOOLEAN DEFAULT false
├── added_as_keyword: BOOLEAN DEFAULT false
├── first_seen: DATE
└── last_seen: DATE

keyword_historical_metrics
├── id: UUID (PK)
├── keyword_text: TEXT
├── year: SMALLINT
├── month: SMALLINT
├── avg_monthly_searches: INTEGER
├── competition: 'LOW' | 'MEDIUM' | 'HIGH'
├── competition_index: SMALLINT
├── low_top_of_page_bid: INTEGER (원)
├── high_top_of_page_bid: INTEGER (원)
├── platform: 'google' | 'naver'
└── UNIQUE (keyword_text, year, month, platform)

campaign_settings
├── id: UUID (PK)
├── tenant_id: UUID
├── platform: 'google' | 'naver' | 'meta'
├── campaign_name: TEXT
├── daily_budget: INTEGER (원)
├── monthly_budget: INTEGER (원)
├── bid_strategy: 'manual' | 'target_cpa' | 'target_roas' | 'maximize_conversions' | 'maximize_conversion_value'
├── target_cpa: INTEGER (원)
├── target_roas: DECIMAL(5,2)
├── status: 'active' | 'paused' | 'archived'
├── start_date: DATE
├── end_date: DATE (NULL = ongoing)
├── season: TEXT (예: 'peak_summer', 'off_winter')
└── created_at: TIMESTAMPTZ

budget_history
├── id: UUID (PK)
├── campaign_id: UUID (FK)
├── date: DATE
├── budget_amount: INTEGER (원)
├── spend: INTEGER (원)
├── reason: TEXT (예: 'seasonal_adjustment', 'ai_optimization', 'manual')
└── created_at: TIMESTAMPTZ

optimization_log
├── id: UUID (PK)
├── keyword_id: UUID (FK → keyword_data, nullable)
├── action: 'bid_increase' | 'bid_decrease' | 'pause' | 'activate' | 'add_negative' | 'budget_change'
├── old_value: INTEGER
├── new_value: INTEGER
├── reason: TEXT
├── triggered_by: 'rule' | 'ai' | 'manual'
├── created_at: TIMESTAMPTZ
└── metadata: JSONB
```

### 2.2 DB 인덱스 전략

```sql
-- 성능 최적화 인덱스
CREATE INDEX idx_kw_perf_date ON keyword_performance_daily(date);
CREATE INDEX idx_kw_perf_kw_id ON keyword_performance_daily(keyword_id);
CREATE INDEX idx_kw_perf_platform ON keyword_performance_daily(platform);
CREATE INDEX idx_search_terms_first_seen ON keyword_search_terms(first_seen);
CREATE INDEX idx_opt_log_created ON optimization_log(created_at);
CREATE INDEX idx_historical_metrics_text ON keyword_historical_metrics(keyword_text);
CREATE INDEX idx_budget_history_date ON budget_history(date);
```

---

## 3. 10년 단계별 로드맵

### Phase 1: "데이터 파이프라인 구축" (2026 H2)
**기간**: Basic Access 승인 후 ~3개월

| 우선순위 | 작업 | 상세 |
|---------|------|------|
| P0 | GenerateHistoricalMetrics 연동 | keyword-brain에 Google Ads API 히스토리컬 메트릭스 연동 |
| P0 | Search Terms 수집 | 매일 검색어 조회 → keyword_search_terms 테이블 저장 |
| P0 | 음성 키워드 자동 추가 | 저성과/무관 검색어 자동 negative 추가 |
| P1 | 일일 성과 수집 | keyword_performance_daily에 자동 적재 |
| P1 | 초기 키워드 Pool 생성 | 여소남 상품 기반 500-1000개 키워드 |
| P1 | 입찰가 최적화 룰 엔진 | 현재 optimizeBids()를 DB 기반으로 고도화 |
| P2 | Naver DataLab 정기 수집 | 월별 검색 트렌드 데이터 적재 |

**완료 조건**: 3개월간 50개+ 전환데이터 + 500개+ 키워드 성과 히스토리

### Phase 2: "반자동 운영 체제" (2027)
**기간**: 6-12개월

| 작업 | 설명 |
|------|------|
| 예산 자동 관리 | 월별 예산 자동 분배 + 일일 예산 동적 조정 |
| Multi-channel 통합 | Google + Naver + Meta 성과 단일 대시보드 |
| Smart Bidding 전환 | 전환데이터 50건+ 확보 후 Target CPA/ROAS 전환 |
| AI Max 적용 | Search Campaigns for Travel + AI Max |
| 예측 모델 도입 | LSTM/Prophet 기반 검색량/전환 예측 |
| A/B 테스트 자동화 | 광고 카피, 입찰가, 랜딩페이지 자동 실험 |
| 주간 리포트 자동 생성 | Slack/이메일 자동 발송 |

### Phase 3: "AI 기반 자동 최적화" (2028-2029)
**기간**: 12-24개월

| 작업 | 설명 |
|------|------|
| 강화학습 입찰 엔진 | 과거 데이터 기반 입찰가 RL 모델 |
| 자동 캠페인 생성 | 신규 상품 등록 시 자동 캠페인/광고그룹/키워드 생성 |
| 경쟁사 분석 | Search Impression Share 기반 경쟁 강도 자동 감지 |
| 시즌 예측 + 대응 | 전년도 데이터 기반 6개월 선제 예산 계획 수립 |
| 크로스채널 어트리뷰션 | 전환 기여도를 채널 간 자동 분배 |
| 자동 랜딩페이지 A/B | 광고별 최적 랜딩페이지 자동 지정 |

### Phase 4: "멀티에이전트 자율 시스템" (2030-2032)
**기간**: 24-36개월

| 작업 | 설명 |
|------|------|
| 전략 에이전트 | 분기별 광고 전략 자동 수립 |
| 운영 에이전트 | 일일 입찰/예산/키워드 운영 전담 |
| 분석 에이전트 | 성과 분석 + 인사이트 도출 |
| 크리에이티브 에이전트 | 광고 카피/이미지 자동 생성 (AI) |
| 리스크 에이전트 | 예산 초과/급등 CPC/정책 위반 감시 |
| 4개 에이전트 협업 | 오케스트레이터가 조율하는 멀티에이전트 시스템 |

### Phase 5: "완전 자율 광고" (2033-2035)
**기간**: 36-60개월

| 작업 | 설명 |
|------|------|
| 전략 수립 자동화 | 시장/경쟁/자사 데이터 기반 연간 광고 전략 AI 수립 |
| 신규 채널 자동 탐색 | 새로운 광고 플랫폼 자동 평가/온보딩 |
| 예산/ROAS 최적화 | 사업 목표에 맞춘 전사 예산 자동 최적화 |
| 비정형 데이터 활용 | 블로그/리뷰/SNS 데이터 → 캠페인 인사이트 |
| 설명 가능한 AI | 모든 의사결정에 대한 자연어 설명 제공 |

---

## 4. AI/ML 모델 로드맵

```
Year 1-2: 규칙 기반 (Decision Trees, Rule Engine)
           ├── CTR/ROAS 임계치 기반 입찰 조정
           ├── 검색량 기반 키워드 Tier 자동 분류
           └── 시즌별 예산 분배 규칙

Year 3-5: 통계/ML 기반
           ├── Prophet으로 검색량 시계열 예측
           ├── Random Forest로 전환율 예측
           ├── K-Means로 키워드 클러스터링
           └── Bayesian 방법론으로 입찰가 최적화

Year 6-8: 딥러닝 기반
           ├── LSTM/Transformer로 검색 트렌드 예측
           ├── 강화학습(PPO)으로 입찰 전략 최적화
           ├── NLP로 검색어 의도 분류
           └── 멀티모달로 광고 크리에이티브 평가

Year 9-10: 자율 AI 시스템
           ├── Multi-Agent RL
           ├── Foundation Model 기반 전략 수립
           ├── Continuous Learning (Online RL)
           └── 설명 가능 자율 의사결정
```

---

## 5. 키워드 시스템 10년 진화 로드맵

### 현재 (2026)
```
키워드 추출: 하드코딩된 템플릿 (extractKeywords)
분류: 규칙 기반 Tier 구분
입찰: 고정 bid 테이블
저장: localStorage
검색량: Naver DataLab or Fallback
```

### Year 1-2 목표 (Phase 1-2)
```
키워드 추출: LLM 기반 (상품 설명 → 키워드 자동 생성)
분류: Google Historical Metrics + Naver DataLab 실제 데이터 기반
입찰: Daily 최적화 루프 (keyword-brain의 optimizeBids 고도화)
저장: Supabase (keyword_data + keyword_performance_daily)
검색량: GenerateHistoricalMetrics + DataLab API
음성 키워드: Search Terms 자동 분석 → 자동 추가
```

### Year 3-5 목표 (Phase 3)
```
키워드 추출: 경쟁사 키워드 분석 + 갭 분석 자동화
분류: ML 기반 (전환 가능성 예측 → 자동 Tier 배정)
입찰: 예측 모델 기반 입찰가 추천 + Smart Bidding 연동
저장: 전환 데이터 + 어트리뷰션 데이터 통합
검색량: 시계열 예측 (6개월 선제)
음성 키워드: 컨텍스트 기반 (검색 의도 이해)
```

---

## 6. 보안/확장성 고려사항

### 보안
- 모든 API 키는 AES-256 암호화 저장 (현재 ENCRYPTION_SECRET_KEY 교체 필요)
- OAuth 토큰 자동 갱신 시스템 (token-resolver.ts 이미 구현됨)
- API 호출 감사 로그 (optimization_log 테이블)
- RLS 정책으로 테넌트 간 데이터 격리

### 확장성
- 멀티테넌트: 모든 테이블에 tenant_id 포함
- DB 인덱스: 일일 수백만 건 성과 데이터 처리
- API Rate Limit: Google 50,000 req/day, Naver 10,000 req/day
- Supabase Row Level Security로 테넌트 격리

---

## 7. 위험 관리

| 위험 | 대응 |
|------|------|
| Google Basic Access 거절 | 개선 후 재신청 (최대 3회), Test Access로 계속 개발 |
| Developer Token 제한 | Standard Access 신청 (추가 심사) 또는 Rate Limit 내 운영 |
| API 정책 변경 | 검증된 API 버전 고정, 정기적 변경사항 모니터링 |
| CPC 급등 | 일일예산 상한 + 급등 감지 시 자동 일시정지 |
| 데이터 손실 | Supabase 백업 + keyword_performance_daily로 이중 저장 |
| 계정 차단/정지 | 모든 결정에 로그, 수동 오버라이드 가능 |

---

## 8. Phase 1 상세 실행 계획 (Basic Access 승인 기간 중)

> 지금부터 승인 기간(예상 1-2주) 동안 진행할 작업

### Week 1: 데이터베이스 & 기반

1. **DB 마이그레이션 생성**
   - `keyword_performance_daily` 테이블 생성
   - `keyword_search_terms` 테이블 생성
   - `keyword_historical_metrics` 테이블 생성
   - `optimization_log` 테이블 생성
   - `budget_history` 테이블 생성

2. **keyword-brain.ts DB 전환**
   - localStorage → Supabase 기반 저장소로 전환
   - `keyword_data` 테이블 활용

3. **keyword-research.ts 고도화**
   - `GenerateHistoricalMetrics` 연동 준비 (Google Ads API)
   - `Naver DataLab` 연동 강화 (이미 구현됨)

### Week 2: API 연동 & 핵심 로직

4. **search-ads-api.ts 확장**
   - `generateHistoricalMetrics()` 함수 추가
   - `fetchSearchTerms()` 함수 추가 (Search Terms View 조회)
   - `addNegativeKeywords()` 함수 추가

5. **입찰 최적화 루프**
   - 일 1회 자동 실행 cron
   - Search Terms 조회 → 저성과 키워드 자동 negative 추가
   - 키워드별 입찰가 자동 조정

6. **mock → 실제 데이터 전환 준비**
   - Basic Access 승인 시 api 키 설정만으로 실제 연동 전환
