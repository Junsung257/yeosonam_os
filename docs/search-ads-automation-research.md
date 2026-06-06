# 검색광고 자동화 리서치 및 구현 원칙

_Updated: 2026-05-31_

## 결론

여소남 검색광고 자동화는 “상품 재고(feed) → 캠페인/광고그룹/키워드 draft → 검수/가드레일 → 실제 발행 → 성과·검색어 기반 학습” 구조가 맞다. Search Ads 360의 템플릿 방식처럼 먼저 미리보기와 paused/draft 상태를 만들고, 외부 광고 API에는 검증된 ID와 예산 상한이 있을 때만 반영한다.

## 참고한 외부 패턴

- [Naver SearchAd API](https://naver.github.io/searchad-apidoc/#/guides): 네이버 검색광고 API는 API Key, Secret, Customer ID 기반 HMAC 인증으로 키워드 도구/성과/입찰 관리에 접근한다.
- [Google Ads API Keyword Ideas](https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas): KeywordPlanIdeaService는 키워드/URL seed로 키워드 아이디어와 과거 지표를 제공한다.
- [Google Ads API Criteria](https://developers.google.com/google-ads/api/docs/targeting/criteria): Google Ads의 키워드는 ad group criterion으로 관리하고, 제외 키워드는 campaign/account 레벨 기준으로 분리한다.
- [Google Ads API Search Campaigns](https://developers.google.com/google-ads/api/docs/campaigns/search-campaigns/getting-started): 검색 캠페인은 campaign → ad group → ad/ad group criteria 순서로 구성된다.
- [Search Ads 360 Templates](https://support.google.com/sa360/answer/13034826?hl=en): campaign/ad group/RSA/keyword/negative keyword 템플릿을 feed 기반으로 생성하고, preview 및 paused 상태를 권장한다.
- [Search Ads 360 Template Types](https://support.google.com/sa360/answer/13013904?hl=en): 템플릿은 캠페인 구조, 타게팅, 크리에이티브를 동적으로 생성·관리하는 방식이다.
- [Optmyzr Rule Engine](https://www.optmyzr.com/solutions/rule-engine/): 검색어 트렌드 분석, 낭비 지출 차단, 키워드 관리 자동화를 “사용자 통제형 규칙”으로 운영한다.
- [Marin Optimization/Pacing](https://support.marinsoftware.com/en_US/Bidding_and_Optimization): 예산 pacing과 spend target 기반 예측/최적화가 대규모 광고 운영의 기본 안전장치다.

## 논문·오픈 리서치에서 가져올 것

- [Multi-armed bandits for performance marketing](https://link.springer.com/article/10.1007/s41060-023-00493-7): 캠페인/광고그룹 단위의 bid·budget 최적화를 contextual bandit으로 풀 수 있다. 여소남은 cold start 구간에서 destination/tier/seasonality를 context로 쓰고, 전환 데이터가 쌓이면 UCB/Thompson Sampling으로 확장한다.
- [Optimizing Online Advertising with Multi-Armed Bandits](https://arxiv.org/abs/2502.01867): 신규 광고의 cold start를 controlled exploration으로 다루는 접근. 여소남의 신규 상품 광고는 longtail에 작은 예산을 배정해 탐색하고, core 키워드는 손실 상한을 둔다.
- [Budget Pacing in Repeated Auctions](https://arxiv.org/abs/2205.08674): 예산 소진 속도를 동적으로 제어하는 pacing 알고리즘. 월 예산/상품별 cap/시간대별 소진율을 자동화 엔진의 P0 가드레일로 둔다.
- [Stochastic Bandits for Multi-platform Budget Optimization](https://arxiv.org/abs/2103.10246): 여러 플랫폼 간 예산 배분 문제를 bandit으로 다룬다. 네이버/구글 성과가 쌓이면 플랫폼별 marginal ROAS를 기준으로 예산 이동 후보를 만든다.
- [Estimation Bias in Multi-Armed Bandit Algorithms for Search Advertising](https://proceedings.neurips.cc/paper_files/paper/2013/file/801c14f07f9724229175b8ef8b4585a8-Paper.pdf): 검색광고 bandit은 관측 편향을 주의해야 한다. 낮은 노출 키워드를 너무 빨리 중지하지 않도록 최소 노출·최소 클릭 기준을 둔다.

## 여소남 적용 원칙

1. **Inventory-first**
   - 상품 승인 시 `travel_packages`를 feed로 보고 검색광고 키워드 플랜을 자동 생성한다.
   - 캠페인명은 `YSN_{destination}_{short_code}`로 고정해 외부 플랫폼과 내부 DB를 연결한다.

2. **Tiered keyword architecture**
   - `core`: 목적지+여행/패키지 같은 고검색량 키워드.
   - `mid`: 기간, 가격대, 상품 유형 조합.
   - `longtail`: 출발지, 기간, 포함사항, 초세부 조합.
   - `negative`: 무료/호텔예약/항공권만/경쟁사 브랜드 등 예산 누수 방지 키워드.

3. **Draft-first safety**
   - 새 상품 승인 시 `search_ad_keyword_plans`에 draft를 저장한다.
   - 실제 광고 계정 생성/입찰/중지는 외부 키워드 ID가 있거나 별도 publish 플래그가 켜진 경우에만 수행한다.

4. **Budget guardrails**
   - 기본 일 예산과 최대 일 예산을 env로 제한한다.
   - core/mid/longtail 가중치로 예산 점유율을 배분하고, negative는 집행 예산 0으로 둔다.

5. **Closed-loop optimization**
   - Naver/Google 성과 sync → `keyword_performances`/`keyword_performance_daily`.
   - 검색어 리포트 → 전환 검색어는 키워드 후보, 고비용 저성과 검색어는 negative 후보.
   - 외부 반영은 `external_keyword_id`가 저장된 행만 허용한다.

## 현재 구현 상태

- 네이버 API 키는 서버 전용 `.env.local`에 저장됐고 `keywordstool` 실호출이 성공했다.
- `src/lib/search-ads-auto-planner.ts`가 상품 기반 네이버/구글 키워드 플랜을 생성한다.
- `search_ad_keyword_plans` 테이블에 draft/approved/published 상태와 외부 ID를 보관한다.
- `/api/admin/search-ads/auto-plan`으로 특정 상품의 광고 키워드 플랜을 생성할 수 있다.
- 상품 단건 승인 흐름에서 검색광고 draft가 자동 생성된다.
- `/admin/search-ads`에 상품 광고 런치센터를 추가해 상품 선택 → draft 생성 → 발행 준비 상태 변경까지 처리한다.

## 남은 P0

- 네이버/구글 실제 campaign/ad group/keyword 생성 API를 “발행 승인” 버튼 뒤에 연결.
- 네이버 채널 ID, Google OAuth refresh token, conversion action 매핑 저장.
- 검색어 리포트에서 negative keyword 자동 초안 생성.
- `/admin/search-ads`에 `search_ad_keyword_plans` 탭 추가.
- 예산 pacing 알림과 월 예산 초과 차단.
## 2026-06-06 implementation note

- SEO-to-Ads bridge is implemented at `/api/admin/ad-os/seo-keyword-bridge`.
- Search-term growth is implemented at `/api/admin/ad-os/search-term-growth`.
- Daily automation is implemented at `/api/cron/ad-os-keyword-growth`.
- The loop now runs: learning harvest -> search-term candidate promotion -> keyword/negative draft -> approval-required change request.
- External platform write remains disabled in this layer. Naver/Google spend stays 0 until the existing approval, budget, adapter, and live-spend preflight gates pass.
