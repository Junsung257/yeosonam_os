# Marketing Command Center Deep Research Audit — 2026-05-30

## 결론

이번 1차 개발로 여소남 OS는 상품별 `Marketing Asset Group`, `Next Best Action`, 안전한 내부 초안 생성까지 갖췄다. 현 상태는 "운영센터 v1"로는 충분하지만, 대형 광고사/플랫폼 수준의 완전자동 마케팅 운영센터가 되려면 아래 6개 레이어가 더 필요하다.

1. Recommendation 적용/기각 이력
2. Google/Meta/Naver 플랫폼 추천 수집
3. Pixel + CAPI 서버 이벤트 품질 점검
4. Asset Group 단위 성과 회수
5. 승인 정책/예산 가드의 UI화
6. 색인/랜딩/광고/예약 전환의 end-to-end health score

## 외부 기준

- Google Ads API는 RecommendationService로 추천을 조회하고, Apply/Dismiss 및 일부 자동 적용 구독을 지원한다. 최적화 점수는 Customer/Campaign 레벨에서 제공된다.  
  Source: https://developers.google.com/google-ads/api/docs/recommendations
- Performance Max의 Asset Group은 하나의 테마/타깃을 중심으로 소재를 묶고, Search/Maps/Display/YouTube/Gmail/Discover 등 여러 지면에 조합된다.  
  Source: https://support.google.com/google-ads/answer/10724748
- Google Ads API의 Performance Max 생성 구조는 AssetGroup에 최소 필수 소재가 없으면 오류가 발생한다고 명시한다.  
  Source: https://developers.google.com/google-ads/api/performance-max/structure-requests
- Google Search Console URL Inspection API는 Search Console에 등록된 속성의 URL 단위 색인 데이터를 프로그래밍 방식으로 제공한다.  
  Source: https://developers.google.com/search/blog/2022/01/url-inspection-api
- Meta Conversions API는 서버/웹/CRM 이벤트를 Meta 최적화·측정 시스템에 직접 연결하고, Pixel과 함께 쓰는 것을 권장한다.  
  Source: https://www.facebook.com/business/help/AboutConversionsAPI

## 현재 우리 코드베이스와의 매칭

### 이미 강한 부분

- 상품/콘텐츠/광고 테이블이 이미 분리되어 있다.
  - `travel_packages`
  - `content_creatives`
  - `card_news`
  - `content_distributions`
  - `ad_campaigns`
  - `ad_creatives`
  - `creative_performance`
  - `ad_performance_snapshots`
- 블로그 자동화 루프가 있다.
  - `blog-scheduler`
  - `blog-publisher`
  - `blog-learn`
  - `blog-daily-summary`
  - `blog-regenerate-zero-click`
- GSC 기반 색인/랭킹 루프가 있다.
  - `gsc-index-rank`
  - `rank-tracking`
  - `seo-monitor`
- 카드뉴스 자동 발행 가드와 학습 루프가 있다.
  - `auto-publish-loop`
  - `card_news_publish_guards`
  - `card_news_publish_decisions`
  - `bandit_arms`
  - `variant-winner-decide`
- 광고 성과 수집 구조가 있다.
  - `sync-creative-performance`
  - Meta는 일부 구현됨
  - Naver/Google은 placeholder 상태
- 이번 개발로 운영자가 한 화면에서 볼 수 있는 통합 레이어가 생겼다.
  - `src/lib/marketing/asset-groups.ts`
  - `src/lib/marketing/action-runner.ts`
  - `/admin/marketing/command-center`

### 아직 비어 있는 핵심

#### P0. Recommendation Ledger

현재 Next Best Action은 계산되고 화면에 표시되지만, "언제 어떤 추천이 왜 나왔고, 누가 적용/기각했고, 적용 후 성과가 어땠는지"가 영구 저장되지 않는다.

필요 테이블:

- `marketing_recommendations`
  - action_id
  - product_id
  - category
  - severity
  - reason
  - evidence_json
  - status: open / applied / dismissed / expired
  - applied_by
  - applied_at
  - dismissed_reason
  - expected_impact_json
  - realized_impact_json

효과:

- Google Ads RecommendationService와 같은 운영 패턴으로 확장 가능
- Jarvis/운영자가 같은 추천 이력을 본다
- 자동화가 헛도는지, 실제 매출/문의로 이어지는지 회수 가능

#### P0. Server-side Conversion API

현재 `MetaPixel.tsx`는 브라우저 Pixel 이벤트 중심이다. 서버 CAPI 전송 모듈은 발견되지 않았다.

필요 구현:

- `src/lib/meta-conversions.ts`
- `POST /api/tracking/meta-conversion`
- Lead/Purchase/CompleteRegistration 서버 이벤트 전송
- browser Pixel과 server CAPI를 같은 `event_id`로 dedupe
- fbp/fbc/gclid/utm/session_id/booking_id 연결
- PII는 SHA-256 hashing 후 전송

효과:

- 광고 차단/브라우저 손실 보완
- 예약/상담/결제 같은 후행 이벤트를 Meta 최적화에 연결
- ROAS/CPA 계산 신뢰도 상승

#### P0. GSC Site URL/Owner 권한 완료

코드는 준비되어 있으나, 실제 테스트에서 `GSC_SITE_URL`이 없었고 문서상 SA Owner 권한 이슈가 남아 있다.

필요:

- `GSC_SITE_URL=https://www.yeosonam.com/` 또는 Search Console 속성과 정확히 같은 값
- `GSC_SERVICE_ACCOUNT_JSON`
- Search Console Owner 권한
- `/api/cron/gsc-index-rank` 실실행
- Command Center에 색인 상태 score 반영

#### P1. Asset Group 성과 회수

이번 구현은 상품별 자산 상태를 묶었지만, 성과는 아직 Action/Asset Group 단위로 회수하지 않는다.

필요:

- `marketing_asset_group_snapshots`
  - product_id
  - readiness_score
  - blog_status
  - social_status
  - ads_status
  - spend_krw
  - clicks
  - leads
  - bookings
  - gross_profit
  - captured_at

효과:

- "준비도 80 이상 상품이 실제 예약 전환도 좋은가" 검증 가능
- 발권마감 임박 상품의 광고/콘텐츠 우선순위 정교화

#### P1. Platform Recommendation 수집

Google Ads/Naver/Meta가 주는 외부 추천을 내부 Next Best Action과 합쳐야 한다.

필요:

- Google Ads RecommendationService
- Google optimization_score 저장
- Naver SearchAd keyword/bid status sync
- Meta adset/campaign delivery diagnostics sync
- 내부 recommendation과 외부 recommendation 통합 ranker

#### P1. Autopilot Policy Center

dry-run 토글이 문서/env에는 많지만, 운영자가 한 화면에서 제어하는 UI는 부족하다.

필요 화면:

- `/admin/marketing/policies`
  - 광고 자동 입찰 반영 여부
  - 카드뉴스 dry-run/live 상태
  - 블로그 자동 발행 batch limit
  - 일일 예산 한도
  - 플랫폼별 publish/deploy 권한
  - 최근 7일 실패율

#### P2. Naver SearchAd/Keyword 실연동

`sync-creative-performance`에서 Naver/Google은 0 반환 placeholder다.

필요:

- Naver SearchAd API auth/signature
- keyword_performances upsert
- bid recommendation apply/dry-run
- negative keyword suggestion
- landing URL/UTM consistency check

#### P2. Creative Quality Preflight

Google PMax/Meta 소재는 최소 요건, 비율, 문구 길이, 랜딩 URL, 정책 이슈가 중요하다.

필요:

- `marketing_creative_preflight`
  - image_ratio_ok
  - text_length_ok
  - landing_url_ok
  - tracking_ok
  - policy_risk
  - required_assets_missing

## 다음 개발 우선순위

1. P0 Recommendation Ledger 마이그레이션 + API + Command Center 적용/기각 UI
2. P0 Meta CAPI 서버 이벤트 + event_id dedupe + booking/lead 연결
3. P0 GSC 설정 완료 후 색인 health score를 Command Center에 병합
4. P1 Asset Group Snapshot cron
5. P1 Autopilot Policy Center
6. P1 Google Ads RecommendationService 연동
7. P2 Naver SearchAd 실연동
8. P2 Creative Preflight

## 최종 판단

현재 시스템은 "자동화 기능의 조각"은 이미 충분히 많다. 추가로 필요한 것은 더 많은 버튼이 아니라, 추천 → 승인/실행 → 성과 회수 → 학습 → 다음 추천으로 이어지는 감사 가능한 폐쇄 루프다.

이번 Command Center v1은 그 루프의 시작점이다. 다음 PR은 반드시 Recommendation Ledger부터 가는 것이 맞다.

## 후속 오류 수정 — 2026-05-30

- `deadline-no-active-ads`가 실제로는 안전한 내부 캠페인 draft 생성 액션인데도 Command Center에서 버튼이 숨겨질 수 있어 draft 생성 가능 액션으로 보정했다.
- 발권마감일이 이미 지난 상품의 문구가 `in -32 days`처럼 보일 수 있어 overdue 문구로 분리했다.
- 같은 추천을 반복 클릭하면 `blog_topic_queue`, `card_news`, `ad_campaigns` 초안이 중복 생성될 수 있어 기존 row 재사용 가드를 추가했다.
- 블로그 초안은 있지만 발행본이 없는 상품을 "블로그 없음"과 구분하기 위해 `blog-draft-not-published` 액션을 별도 분리했다.
- Command Center 가격 표기를 `e/man`에서 한국어 운영 UI에 맞게 `억/만`으로 보정했다.
