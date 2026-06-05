# 블로그 생성 자동화 전수조사 (2026-06-04)

## 결론

블로그 자동화는 이미 `blog_topic_queue` 기반으로 스케줄링, 발행, 품질 게이트, 카드뉴스 브리지, 광고 매핑, RAG 색인, Search Console/GSC 점검까지 이어져 있다.
이번 점검에서 보강한 핵심은 세 가지다.

1. 일반 정보성 블로그도 본문 H2 아래 사진이 자동 삽입되도록 `ensureBlogInlineImages()`를 발행기에 연결했다.
2. Google 일반 블로그 색인은 공식 지원 범위에 맞춰 Search Console Sitemap API를 기본 경로로 삼고, Indexing API 직접 호출은 명시 설정일 때만 보조로 제한했다.
3. `/api/blog/bulk-reindex`는 단건 반복 호출 대신 `notifyIndexingBatch()`로 Google sitemap 제출과 IndexNow batch 요청을 묶어 외부 API 호출 수를 줄였다.

## 자동화 흐름

| 단계 | 구현 위치 | 상태 |
|---|---|---|
| 토픽 생성·충전 | `src/app/api/cron/blog-scheduler/route.ts`, `src/app/api/blog/queue/route.ts` | 자동 |
| 발행 큐 처리 | `src/app/api/cron/blog-publisher/route.ts` | 자동 |
| 카드뉴스 → 블로그 변환 | `src/app/api/blog/from-card-news/route.ts`, `src/lib/blog-card-news-bridge.ts` | 자동 |
| 카드뉴스 PNG 안정화 대기 | `src/lib/card-news-render-readiness.ts`, `src/lib/card-news-slide-urls.ts` | 자동 |
| 본문 사진 삽입 | `src/lib/blog-inline-images.ts`, `src/lib/blog-image-seo.ts` | 자동 보강 완료 |
| SEO 품질 점수 | `src/lib/blog-seo-scorer.ts` | 자동 |
| 품질 게이트 | `src/lib/blog-quality-gate.ts` | 자동 |
| 구조화 데이터 | `src/lib/blog-jsonld.ts`, `src/app/blog/[slug]/page.tsx` | 자동 |
| 내부링크·CTA | `src/lib/topical-authority.ts`, `src/lib/blog-cta.ts` | 자동 |
| 광고 랜딩 매핑 | `src/lib/blog-ad-mapping-auto.ts` | 자동 |
| 검색엔진 알림 | `src/lib/indexing.ts`, `src/lib/gsc-client.ts` | 자동 보강 완료 |
| 대량 재색인 | `src/app/api/blog/bulk-reindex/route.ts`, `src/lib/indexing.ts` | 배치화 완료 |
| GSC 색인·순위 점검 | `src/app/api/cron/gsc-index-rank/route.ts` | 자동 |
| SEO 모니터링 | `src/app/api/cron/seo-monitor/route.ts`, `/admin/seo-monitor` | 자동 |
| 장애 자가복구 | `src/lib/blog-content-orchestrator.ts` | 자동 |

## 운영 설정 체크

| 항목 | 필요 설정 |
|---|---|
| 본문 사진 자동 삽입 | `PEXELS_API_KEY` 권장. 없으면 기존 OG/브랜드 이미지 중심으로만 보강 |
| IndexNow | `INDEXNOW_KEY` 및 `https://도메인/{INDEXNOW_KEY}.txt` 루트 공개 파일 |
| Google Search Console | `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL` |
| Google 일반 블로그 직접 Indexing API | 기본 비활성. 실험 시 `GOOGLE_INDEXING_API_FOR_BLOGS=true` |
| 크론 인증 | `CRON_SECRET` |

## 확인 쿼리

```sql
-- 최근 발행 글의 SEO/사진/품질 상태
SELECT slug, published_at, quality_gate, seo_score
FROM content_creatives
WHERE channel = 'naver_blog'
  AND status = 'published'
ORDER BY published_at DESC
LIMIT 20;

-- 최근 색인 알림 결과
SELECT url, google_status, google_error, indexnow_status, indexnow_error, sitemap_pings, reported_at
FROM indexing_reports
ORDER BY reported_at DESC
LIMIT 20;
```

## 남은 주의점

- Google Indexing API는 일반 블로그용 공식 주력 경로가 아니다. Google은 Search Console 사이트맵 제출, robots.txt sitemap, URL Inspection으로 운영한다.
- 카드뉴스는 생성·렌더·큐 투입·블로그 변환까지 자동 연결되어 있다. 다만 일반 블로그에서 카드뉴스를 역방향으로 자동 파생하려면 별도 `content-gaps`/`content-factory` 정책을 통해 상품 단위 OSMU 작업으로 처리하는 것이 안전하다.
