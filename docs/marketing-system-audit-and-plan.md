# 여소남 마케팅 시스템 종합 진단 및 실행 계획

> 작성일: 2026-05-24
> 기준: Google Ads Developer Token (Basic Access 신청 완료, 검토 대기 중)

---

## 1. 현재 시스템 현황

### 1.1 구축된 파이프라인 구성

| 모듈 | 파일 | 상태 |
|------|------|------|
| 마케팅 오케스트레이터 | `marketing-pipeline/orchestrator.ts` | 구현됨 |
| 광고 게시 에이전트 | `marketing-pipeline/agents/ad-publish-agent.ts` | 구현됨 (Meta, Google, Naver) |
| 키워드 브레인 | `marketing-pipeline/agents/keyword-brain.ts` | 구현됨 (키워드 분류/입찰) |
| 컨텐츠 생성 에이전트 | `marketing-pipeline/agents/content-agent.ts` | 구현됨 |
| 소셜 퍼블리셔 | `social-publisher.ts` | Facebook/Instagram/Threads 연동 |
| Google Ads API | `search-ads-api.ts` | 구현됨 (v16, OAuth2) |
| Meta API | `meta-api.ts` | 구현됨 |
| Naver SearchAd API | `search-ads-api.ts` | 구현됨 |
| 시크릿 관리 | `secret-registry.ts` | 구현됨 |

### 1.2 보유한 API 키/토큰

| 항목 | 상태 |
|------|------|
| Google Ads Developer Token | `.env.local` 서버 전용 저장 완료 (Test Access → Basic 신청 중) |
| Google Ads Manager Account | `313-217-4750` ✅ |
| Google Ads OAuth2 Client | 구성 완료 ✅ |
| Meta 앱 (Facebook/Instagram) | 등록 완료 ✅ |
| Naver SearchAd API | 미등록 ❌ |
| Twitter/X API | 미등록 ❌ |
| Naver Cafe API | 미등록 ❌ |

---

## 2. 글로벌 최신 광고 트렌드 (2025-2026)

### 2.1 여행 업계 Google Ads 벤치마크

| 지표 | 수치 | 출처 |
|------|------|------|
| 여행업 Google Ads CTR | **8.24%** (전 산업 최고) | Foundry CRO 2026 |
| CPC 변동폭 | 비수기 대비 성수기 **200~400%** 상승 | Foundry CRO 2026 |
| Q1 CPC | 기준 대비 **-30~50%** (가장 저렴) | Foundry CRO 2026 |
| Q3 CPC | 기준 대비 **+100~400%** (가장 비쌈) | Foundry CRO 2026 |
| 국내 예약 윈도우 | 평균 **39일** 전 | blog.google 2025 |
| 해외 예약 윈도우 | 평균 **49일+** 전 | blog.google 2025 |
| AI Overviews 노출 시 CTR | **61% 감소** (1.76% → 0.61%) | Search Engine Land 2025 |
| AI 여행 계획 활용 | 미국 소비자의 **40%** (전년비 +11%p) | Phocuswright 2026 |

### 2.2 Smart Bidding 핵심 원칙 (Google 공식)

1. **Conversion Tracking이 가장 중요** - Smart Bidding의 기반은 정확한 전환 추적
2. **Learning Period**: 전환 50건 or 3전환사이클 필요
3. **Auction-time 최적화**: Google AI가 경매마다 입찰가 실시간 조정
4. **Query-level 모델링**: 검색어 수준의 전환 데이터로 저-volume 키워드도 정확한 입찰 가능
5. **Seasonality Adjustment**: 1-7일 단기 이벤트 전용, 월 단위 시즌에는 예산/CPA 수동 조정 권장

### 2.3 AI Max for Search (2026년 신기능)

- Search 캠페인에 AI 기능 통합: **+14% 전환율/전환가치** (유사 CPA/ROAS)
- 기존 구문/정확히일치 키워드만 쓰는 계정은 **+27%** 향상
- **Search Campaigns for Travel** (2026.4월 발표): 여행 전용 광고 형식을 표준 Search 캠페인으로 통합
- Newmarket Holidays 사례: AI Max 도입 후 **ROAS +14.9%**, 수익 +5.7%

---

## 3. 키워드 전략 상세 분석

### 3.1 검색량 데이터 활용 방안

**Google Ads API GenerateHistoricalMetrics 활용:**

```typescript
// API로 작년 동월 검색량 조회
KeywordPlanIdeaService.generateHistoricalMetrics({
  keywords: ["일본 패키지 여행", "보홀 패키지"],
  historical_metrics_options: {
    include_average_monthly_searches: true,
    year_month_range: { start: "2025-01", end: "2026-05" }
  }
});
```

**출력 데이터:**
- 월별 검색량 (최근 12-24개월)
- 경쟁 수준 (0-100 지수)
- 상위노출 입찰가 하한/상한 (20th/80th percentile)
- 월별 검색량 추이 데이터

### 3.2 여행업 키워드 시즌별 전략

**연간 예산 분배 모델:**

| 시즌 | 시기 | CPC | 예산 비중 | 전략 |
|------|------|-----|-----------|------|
| **비수기 (Q1)** | 1-3월 | 기준대비 **-30~50%** | 20% | 브랜드 광고 + 신규 키워드 테스트 |
| **준성수기 (Q2)** | 4-6월 | 기준대비 **0~+30%** | 30% | 규모 확장, 7-30일 내 예약자 타겟 |
| **성수기 (Q3)** | 7-9월 | 기준대비 **+100~400%** | 30% | 최고 ROAS 채널 집중, 리타겟팅 위주 |
| **연말 (Q4)** | 10-12월 | 기준대비 **+50~200%** | 20% | 겨울 여행 extended-window 공략 |

> **중요**: 성수기 여행 상품은 **6-12주 전**에 광고 집행 시작
> - 국내 패키지: 여행 39일 전부터 광고 시작
> - 해외 패키지: 여행 49일+ 전부터 광고 시작
> - 비수기에도 광고를 완전히 멈추지 말 것 (알고리즘 학습 데이터 유실 + Quality Score 하락)

### 3.3 세세세부 키워드 입찰 전략 (마이크로 키워드)

**3단계 프로세스:**

```
[Step 1] 키워드 생성
  ├── Core 키워드: "일본 패키지 여행", "유럽 패키지"
  ├── Mid 키워드: "오사카 3박4일 패키지", "발리 허니문 패키지"
  ├── Long-tail: "오사카 가족 여행 3박4일 항공+호텔 패키지"
  └── 조합형(지역+상품+의도): "겨울 오사카 온천 여행 패키지 추천"

[Step 2] 초저가 입찰 (Data Collection Phase)
  ├── CPC: 업계 기준의 30-50% 수준으로 시작
  ├── 기간: 7-14일
  ├── 목표: 검색량 대비 클릭 데이터 수집
  └── 평가지표: CTR, 노출 점유율, 전환율

[Step 3] 데이터 기반 최적화
  ├── 고성과 키워드: 입찰가 점진적 인상 (10-20%/주)
  ├── 중간 키워드: ROI 임계치까지 유지
  ├── 저성과 키워드: 입찰가 인하 or 일시중지
  └── 음성 키워드: 불필요한 검색어 정기적 추가
```

### 3.4 Google Smart Bidding과 연계 전략

**권장 단계적 접근:**

1. **초기 (1-2개월): 수동 입찰 + 키워드 테스트**
   - 세세세부 키워드 직접 입찰
   - 검색어 보고서 기반 음성 키워드 정리
   - 주 2회 수동 최적화

2. **중기 (2-3개월): Portfolio Bidding 도입**
   - 전환 데이터 50건 이상 확보 후 Target CPA 전환
   - 검색어 수준 데이터로 Smart Bidding 학습 가속
   - 초기 Target CPA: 예상 CPA의 1.5배로 설정 (너무 빡빡하게 잡지 않음)

3. **안정기 (3개월+): Smart Bidding + AI Max**
   - Target CPA / Target ROAS 전환
   - AI Max 활성화로 검색어 확장
   - 1-2주마다 CPA/ROAS 목표 10-15%씩 조정

---

## 4. 완전자동화 가능성 진단

### 4.1 현재 자동화 수준

| 영역 | 현재 | 목표 |
|------|------|------|
| 키워드 생성 | 자동화 ✅ (keyword-brain) | 유지 |
| 키워드 분류 (Core/Mid/Long-tail/Negative) | 자동화 ✅ | 유지 |
| 초기 입찰가 설정 | 자동화 ✅ (keyword-brain) | 유지 |
| 캠페인 생성 | 코드 구현됨 ⚠️ | 실제 API 연동 (Basic Access 승인 후) |
| 광고 카피 생성 | 자동화 ✅ (content-agent) | 유지 |
| 성과 리포트 | 미구현 ❌ | 추가 필요 |
| 입찰가 자동 최적화 | 미구현 ❌ | 추가 필요 |
| 음성 키워드 자동 추가 | 미구현 ❌ | 추가 필요 |
| 예산 자동 조정 | 미구현 ❌ | 추가 필요 |
| 시즌별 캠페인 활성/비활성 | 미구현 ❌ | 추가 필요 |

### 4.2 추가 개발 필요 기능 (Priority 순)

**P0 - 광고 운영에 필수 (즉시 필요):**

1. **검색어 보고서 조회 기능**
   ```typescript
   // Google Ads API로 search_terms_view 조회
   function getSearchTerms(campaignId, days): SearchTerm[]
   // → 불필요한 검색어 식별 → 음성 키워드 자동 추가
   ```

2. **음성 키워드 자동 관리**
   ```typescript
   function suggestNegativeKeywords(searchTerms, campaignKeywords): string[]
   function addNegativeKeywords(campaignId, keywords): void
   ```

3. **입찰가 최적화 루프**
   - 1일/1회 실행
   - 각 키워드의 CTR, 전환율, CPA 계산
   - 규칙 기반 입찰가 조정 (성과 좋으면 +10%, 나쁘면 -20%)

**P1 - 효율 향상:**

4. **월별 예산 자동 조정** (API의 seasonality 기능 아닌 수동 조정)
5. **성과 대시보드 + 리포트 자동 생성**
6. **비수기/성수기 캠페인 스케줄러**

**P2 - 고도화:**

7. **A/B 테스트 프레임워크** (광고 카피, 입찰 전략, 랜딩 페이지)
8. **경쟁사 분석 연동**
9. **멀티 채널 크로스어트리뷰션**

---

## 5. 단계별 실행 계획

### Phase 1: 기초 체력 강화 (1-2주)

**목표: 광고 운영을 위한 최소 시스템 구축**

```
[-] Google Ads Basic Access 승인 대기 (3영업일, 이미 신청 완료)
[ ] GenerateHistoricalMetrics API 연동 (keyword-brain에 검색량 데이터 연결)
[ ] Google Ads 전환 추적 코드 사이트 설치 (전환 데이터 수집 기반)
[ ] Search Terms 조회 기능 추가 (불필요한 검색어 필터링)
[ ] Meta Pixel + Google Ads 전환 공유 설정
```

**예상 예산: 일 1-3만원 (소규모 테스트)**

### Phase 2: 테스트 캠페인 운영 (3-6주)

**목표: 실제 데이터 수집 및 알고리즘 학습**

```
[ ] Phase 1 완료 후 3-5개 핵심 상품군 키워드 선정
[ ] 키워드당 5-10개의 마이크로 키워드 생성
[ ] 수동 입찰로 초기 캠페인 시작 (CPC 업계 평균의 50% 수준)
[ ] 일 1회 검색어 보고서 확인 → 음성 키워드 즉시 추가
[ ] 전환 데이터 50건 확보 목표
[ ] 주 1회 Google Ads 벤치마크 대비 성과 리뷰
```

**키워드 우선순위 예시 (여행 상품 기준):**

| 우선순위 | 키워드 그룹 | 예상 검색량 | 권장 초기 CPC |
|----------|-------------|------------|--------------|
| 1순위 | 브랜드 키워드 ("여소남", "여소남 패키지") | 낮음 | ₩200-500 |
| 2순위 | 인기 여행지 + 패키지 ("일본 패키지 여행") | 높음 | ₩800-1,500 |
| 3순위 | 특정 상품 롱테일 ("보화 패키지 3박4일") | 중간 | ₩500-800 |
| 4순위 | 마이크로 키워드 ("겨울 오사카 가족 여행") | 낮음 | ₩200-500 |

### Phase 3: 자동화 고도화 (7-12주)

**목표: AI 기반 자동 최적화 시스템 구축**

```
[ ] 전환 데이터 50건+ 확보 후 Target CPA 전환
[ ] Portfolio Bidding 도입 (그룹별 입찰 전략)
[ ] AI Max 활성화 (Search Campaigns for Travel)
[ ] 입찰가 자동 최적화 루프 활성화
[ ] 시즌별 예산 자동 조정 시스템
[ ] 성과 리포트 자동 생성
```

### Phase 4: 멀티 채널 확장 (13주+)

**목표: 전 채널 통합 운영**

```
[ ] Naver SearchAd API 연동 (키워드 미등록 상태)
[ ] Twitter/X API 연동
[ ] Meta 캠페인 자동화 고도화 (기존 meta-api.ts 활용)
[ ] 크로스채널 어트리뷰션 도입
[ ] 리타겟팅 자동화
```

---

## 6. 즉시 실행 가능한 작업

### 6.1 Basic Access 승인 전에 할 수 있는 일

- [ ] **keyword-brain.ts**에 `GenerateHistoricalMetrics` 연동 (검색량 데이터 기반 키워드 선정)
- [ ] **search-ads-api.ts**에 `SearchTermView` 조회 함수 추가
- [ ] **오케스트레이터**에 일일 최적화 루프 추가 (cron job 기반)
- [ ] **전환 추적** 문서 정리 및 사이트에 설치
- [ ] **초기 키워드 Pool** 작성 (여소남 여행 상품 기준)

### 6.2 Basic Access 승인 후 즉시 실행

- [ ] Test 캠페인 생성 및 실행
- [ ] Data Collection Phase 시작
- [ ] Search Terms 모니터링 시작

---

## 7. 핵심 결론

**완전 자동화는 가능합니다.** 하지만 단계적 접근이 필요합니다:

1. **먼저 사람이 운영 패턴을 확립** → 데이터가 쌓이면
2. **규칙 기반 자동화 도입** → 성과가 검증되면
3. **AI 기반 자동 최적화로 전환**

> **가장 중요한 원칙**: Google Smart Bidding은 전환 데이터가 생명입니다. 첫 1-2개월은 데이터 수집에 집중하고, 성급한 자동화 도입은 피해야 합니다. 비수기(Q1)에 가장 저렴한 CPC로 데이터를 쌓고, 성수기(Q3) 전에 최적화를 완료하는 것이 효율적입니다.

**첫 번째 실행 단계**: GenerateHistoricalMetrics API 연동 후, 작년 동월 데이터 기준으로 키워드 Pool을 작성하는 것부터 시작하는 것을 추천합니다.
