# 블로그 시스템 운영 런북 (Runbook)

> 여소남 블로그 자동 발행 시스템 운영 가이드 — 매일/매주/매월 확인 사항

---

## 🚀 배포 직후 1회 실행 (Day 0)

### 1. DB 마이그레이션 실행 순서
Supabase Dashboard > SQL Editor에서 순서대로:
```sql
-- 이미 MCP로 적용 완료이지만, 다른 환경 재현 시:
\i db/blog_autopublish_v1.sql
\i db/blog_ad_integration_v1.sql
\i db/blog_featured_pillar_v1.sql
```

### 2. 초기 시드
별도 Node 시드 스크립트는 현재 유지하지 않는다. 다른 환경 재현 시 위 SQL 3개를 먼저 적용한 뒤, `/admin/blog/queue`와 Supabase의 `prompt_versions`/`blog_topic_queue` 상태를 확인한다.

### 3. 첫 스케줄러 수동 실행
```bash
# Vercel 배포 직후, 첫 월요일 자동 실행을 기다리지 말고
# 운영 CRON_SECRET 또는 Vercel Cron 인증 헤더가 있는 환경에서 실행한다.
curl -H "Authorization: Bearer $CRON_SECRET" https://www.yeosonam.com/api/cron/blog-scheduler
```
→ 17개 destination 중 Pillar 없는 곳 큐잉 + 42개 주간 토픽 충전

### 4. 첫 블로그 발행 수동 트리거
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://www.yeosonam.com/api/cron/blog-publisher
```
→ 1시간 안 기다리고 즉시 6개까지 생성 시도

### 5. 검증
- `/admin/blog/queue` 접속 → 큐 항목들 발행 상태 확인
- `/blog` 접속 → 생성된 글들 표시 확인
- `/destinations/다낭` 등 접속 → Pillar 페이지 렌더 확인
- `/admin/blog/ads` 접속 → 광고 매핑 UI 동작 확인

---

## 📅 매일 확인 (5분)

1. **`/admin/blog/queue` 대시보드** 접속
   - 🔴 `failed` 항목 있으면 클릭해서 `last_error` 확인
   - `generating` 항목이 30분 이상 머물러 있으면 수동 `queued` 로 되돌리기 (UI에서 활성 토글)

2. **Vercel Cron 로그**
   - Vercel Dashboard > Project > Crons 탭
   - `blog-publisher` 는 `vercel.json` 기준 **UTC 03:05, 06:05, 09:05, 12:05** 실행 (KST 12:05, 15:05, 18:05, 21:05)
   - `blog-scheduler` 는 `vercel.json` 기준 **UTC 일요일 15:00** 실행 (KST 월요일 00:00)
   - `blog-lifecycle` 이 매일 KST 01:30 실행 확인

3. **알림 체크**
   - Slack 웹훅 설정했으면 `#blog-alerts` 채널 확인

4. **사진·색인 자동화 체크**
   - 새 글 본문에 이미지가 최소 2~3장 들어갔는지 확인 (`seo_score.details`의 이미지 SEO 항목)
   - 새 글 상세 페이지에서 본문 이미지가 실제 `<img>`로 보이는지 확인한다. 화면에 `![...](...)`, `##`, `[링크](...)`, `|---|` 같은 마크다운 원문이 보이면 즉시 배포 중단.
   - 발행 품질 게이트의 `render_integrity` 가 `passed=true`인지 확인한다. 실패 시 원문은 저장하지 말고 렌더러/마크다운 구조를 먼저 수정한다.
   - `indexing_reports` 최신 행에서 `sitemap_pings` 안의 `google_search_console_sitemap` 이 `ok=true`인지 확인
   - `INDEXNOW_KEY` 미설정이면 Bing/IndexNow는 `skipped`가 정상이며, 운영 전에는 루트 key 파일 배포가 필요
   - 대량 재색인은 `/api/blog/bulk-reindex`를 사용한다. 이 경로는 Google sitemap 제출과 IndexNow 요청을 batch로 묶어 호출한다.

---

## 📆 매주 확인 (15분, 월요일)

1. **주간 생성 리포트**
   ```sql
   SELECT DATE(published_at), COUNT(*), STRING_AGG(content_type, ',')
   FROM content_creatives
   WHERE channel='naver_blog' AND published_at >= NOW() - INTERVAL '7 days'
   GROUP BY 1 ORDER BY 1 DESC;
   ```

2. **Featured 로테이션 확인**
   - `/blog` 페이지 상단 Featured 3개가 바뀌었는지
   - 바뀌지 않았으면 `blog-learn` 크론 로그 확인

3. **자기학습 대기 제안**
   - `/admin/agent-actions` (또는 Supabase `agent_actions` 테이블 직접 조회)
   - `status='pending'`, `action_type='prompt_improvement_suggestion'` 확인
   - 승인 OK면 "승인" 클릭 → prompt_versions 자동 신규 버전

4. **광고 매핑 성과**
   - `/admin/blog/ads` — 플랫폼별 클릭/전환 확인
   - `ad_landing_mappings.clicks / conversions` 비율 체크
   - 전환율 낮은 매핑은 DKI 헤드라인 수정

---

## 🗓 매월 확인 (30분, 1일)

1. **시즌 캘린더 갱신**
   ```bash
   # 자동 — 매주 월 스케줄러가 분기별로 갱신
   # 수동 강제 재생성:
   curl -X POST https://yeosonam.com/api/blog/queue -d '{"action":"regenerate_seasonal"}'
   ```

2. **죽은 상품 블로그 확인**
   - 자동 archive 되고 있지만 스팟 체크:
   ```sql
   SELECT slug, destination, published_at FROM content_creatives
   WHERE content_type='package_intro' AND status='archived'
   AND updated_at >= NOW() - INTERVAL '30 days';
   ```

3. **Google Search Console 체크**
   - 색인 상태 / 클릭 수 / 평균 순위
   - 상위 10개 키워드 확인
   - 색인 누락된 글 있으면 `/api/blog/reindex` 또는 `/api/blog/bulk-reindex`로 재전송
   - 일반 블로그는 Google Indexing API 직접 호출보다 Search Console Sitemap API + URL Inspection을 기본으로 본다
     - 이유: Google 공식 지원 범위상 Indexing API는 JobPosting/BroadcastEvent 중심
     - 예외적으로 직접 호출까지 테스트하려면 `GOOGLE_INDEXING_API_FOR_BLOGS=true` 설정

4. **리뷰 수집률**
   ```sql
   SELECT
     COUNT(DISTINCT b.id) AS eligible_bookings,
     COUNT(DISTINCT r.id) AS collected_reviews,
     ROUND(COUNT(DISTINCT r.id)::numeric / COUNT(DISTINCT b.id) * 100, 1) AS rate_pct
   FROM bookings b
   LEFT JOIN post_trip_reviews r ON r.booking_id = b.id
   WHERE b.status = 'completed' AND b.end_date < NOW();
   ```
   → 목표 15~25%. 낮으면 Solapi 템플릿 문구 개선

---

## 🆘 트러블슈팅

### 글 본문 사진이 깨지고 마크다운이 그대로 보임
- 증상: `/blog/[slug]` 본문에 `##`, `![이미지](url)`, `[링크](url)`, 표 파이프(`|`)가 그대로 노출되고, 본문 이미지가 실제 사진으로 렌더되지 않는다.
- 대표 사고: 2026-06-07 `/blog/zhangjiajie-weather` 및 최신 글 다수에서 본문 이미지 3장이 모두 마크다운 텍스트로 노출됨.
- 근본 원인: `content_creatives.blog_html`은 "마크다운 + 안전한 HTML(`<figcaption>`, `<aside>`)" 혼합 저장값인데, 상세 페이지가 `<figcaption>` 태그를 보고 전체를 raw HTML로 오판해 `marked.parse()`를 건너뜀.
- 재발 방지:
  - 상세 페이지는 반드시 `src/lib/blog-renderer.ts`의 `renderBlogContentToHtml()`만 사용한다.
  - 발행 전 `runQualityGates()`의 `render_integrity` 게이트를 통과해야 한다.
  - 테스트 `src/lib/blog-renderer.test.ts`는 `<figcaption>`이 섞인 마크다운도 `<h2>`, `<img>`, `<a>`로 렌더되는지 검증한다.
  - 단순히 이미지 URL 200 응답만 보면 안 된다. 실제 DOM에 `<article img>`가 있고 본문 텍스트에 마크다운 원문이 남지 않았는지 같이 본다.

### 블로그 자동 생성 중단됨
```bash
# 1) 큐 상태 확인
curl https://yeosonam.com/api/blog/queue

# 2) 퍼블리셔 수동 실행
curl -H "Authorization: Bearer $CRON_SECRET" https://www.yeosonam.com/api/cron/blog-publisher

# 3) GOOGLE_AI_API_KEY 쿼터 확인 (Gemini 콘솔)
```

### Pillar 페이지 빈 내용
- `/destinations/[city]` 접속 → "완벽 가이드가 곧 공개됩니다" 메시지만 뜸
- 원인: `blog-scheduler` 가 아직 Pillar 큐잉 안 함
- 해결:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://www.yeosonam.com/api/cron/blog-scheduler   # 큐잉
  curl -H "Authorization: Bearer $CRON_SECRET" https://www.yeosonam.com/api/cron/blog-publisher   # 즉시 생성
  ```

### 광고 매핑 UTM URL 작동 안 함
- `ad_landing_mappings.landing_url` 확인 — 실제 클릭 테스트
- DKI 매칭 안 될 때: utm_campaign 과 utm_term 대소문자 일치 확인 (소문자 표준)

### 자기학습 제안이 안 생김
- 최소 임계값: 발행 블로그 30개 + engagement 50건
- 충족 전까지 `blog-learn` 크론이 조용히 skip
- 현재 상태: `curl https://yeosonam.com/api/agent/prompt-optimizer` (GET)

### GSC 롱테일 자동 확장 확인
- 크론: `/api/cron/blog-longtail-expander`가 `rank-tracking` 이후 매일 실행된다.
- 역할: `rank_history`의 실제 GSC winning query를 seed로 삼아 관련검색어/검색량/경쟁도를 붙이고, 기존 글과 큐의 유사 키워드를 제외한 뒤 `blog_topic_queue.source='gsc_longtail'`로 등록한다.
- 큐에 넣기 전 후보만 확인:
  ```bash
  curl "https://yeosonam.com/api/cron/blog-longtail-expander?dry_run=1&limit=5"
  ```
- 최근 등록 확인:
  ```sql
  SELECT primary_keyword, keyword_tier, monthly_search_volume, competition_level, priority, created_at
  FROM blog_topic_queue
  WHERE source = 'gsc_longtail'
  ORDER BY created_at DESC
  LIMIT 20;
  ```

### Keyword Growth Engine 확인
- 대시보드: `/admin/blog/keyword-growth`
- API: `/api/admin/blog/keyword-growth?days=28`
- 핵심 루프: GSC query seed -> semantic dedupe -> keyword family -> SERP 분석 -> 발행 -> GSC/전환 성과 재학습
- `blog_keyword_families`: 비슷한 롱테일을 대표 키워드 중심으로 묶는다.
- `blog_keyword_family_members`: 후보/보조/대표 역할, 점수, seed query, 잠식 위험을 저장한다.
- `content_creatives.generation_meta.serp_analysis`: 롱테일 발행 시 참고한 경쟁 SERP 패턴을 저장한다.
- `content_creatives.generation_meta.originality_signals`: 여소남 내부 상품/예약/가격 신호를 저장한다.
- `content_creatives.generation_meta.freshness_monitor`: 비자/입국/안전/환율/날씨/공항 이동/가격 글의 재검토 필요 여부를 저장한다.
- 수동 점검:
  ```bash
  curl "https://yeosonam.com/api/cron/blog-longtail-expander?dry_run=1&limit=5"
  curl "https://yeosonam.com/api/cron/blog-freshness-monitor?dry_run=1&limit=20"
  ```

---

## 🎯 KPI 대시보드 (월간 리포트)

| 지표 | 목표 | 측정 |
|---|---|---|
| 월간 블로그 발행 수 | 150~180편 (하루 6개 × 25일) | `SELECT COUNT(*) FROM content_creatives WHERE published_at >= DATE_TRUNC('month', NOW())` |
| 자동 발행 성공률 | 95% 이상 | `status='published'` / (published + failed) |
| 평균 3-Gate 통과율 | 90% 이상 | `quality_gate->>'passed'='true'` |
| 평균 본문 이미지 수 | 글당 2장 이상 | `seo_score` 이미지 SEO 항목 또는 마크다운 이미지 수 |
| 평균 조회수 (30일) | 글당 50+ | `AVG(view_count)` |
| Pillar 페이지 커버리지 | 17/17 active destinations | `SELECT destination FROM active_destinations WHERE destination NOT IN (SELECT pillar_for FROM content_creatives WHERE content_type='pillar')` |
| 리뷰 수집률 | 15%+ | 위 SQL 참조 |
| 자기학습 버전업 주기 | 월 1~2회 | `SELECT COUNT(*) FROM prompt_versions WHERE created_at >= NOW() - INTERVAL '30 days'` |

---

## 📞 비상 연락

- **Supabase 장애**: https://status.supabase.com
- **Vercel 장애**: https://vercel-status.com
- **Solapi 장애**: https://solapi.com/status
- **Gemini API 쿼터**: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com

---

## Blog Render Integrity Audit (2026-06-07)

블로그 상세 본문은 이미지 URL 200 응답만으로 정상 판단하지 않는다. 실제 DOM 기준으로 마크다운 원문 잔여물과 본문 이미지/제목 렌더를 함께 확인한다.

### 필수 명령

- 배포 전 로컬: `npm run audit:blog-render:browser -- --base=http://localhost:3002`
- 운영 현재 상태: `npm run audit:blog-render:browser -- --base=https://www.yeosonam.com`
- JSON 보고서가 필요하면 뒤에 `--json`을 붙인다.

### 100점 기준

- `score=100`
- `failed=0`
- `errors=0`
- 모든 글의 `artifactTotal=0`
- 본문 이미지가 필요한 일반 글은 `imgCount>0`
- 본문 구조형 글은 `h2Count>=2`

### 판정 원칙

- PPR/스트리밍 페이지는 서버 HTML만 보면 `<article>` 본문이 비어 오탐이 날 수 있으므로 전수 감사는 반드시 `--browser-fallback`으로 실제 브라우저 DOM을 재확인한다.
- `content_creatives.blog_html`은 마크다운과 안전한 HTML(`<figcaption>`, `<aside>`)이 섞일 수 있다. `<tag>` 존재만으로 raw HTML이라고 판단하면 안 된다.
- 상세 페이지는 `src/lib/blog-renderer.ts`의 `renderBlogContentToHtml()`을 통해 렌더한다.
- 발행 전 품질 게이트는 `render_integrity`를 통과해야 한다.
- 2026-06-07 사고 기준 운영 사이트는 99개 글 중 99개 실패(`score=0`, `avgImages=0`, `avgArtifacts=45.2`)였고, 로컬 개선판은 99개 글 모두 통과(`score=100`, `failed=0`, `avgImages=3`)했다.

---

## Blog Image Quality Audit (2026-06-07)

렌더 감사는 `![이미지](url)`가 실제 `<img>`로 변환되는지 보는 검사다. 이미지 품질 감사는 실제 글에 배치된 사진이 깨지지 않았는지, alt/caption이 비어 있지 않은지, 같은 글 안에서 중복되지 않는지, 제목/목적지 토큰과 연결되는지 보는 별도 검사다.

### 필수 명령

- 배포 전 로컬: `npm run audit:blog-images -- --base=http://localhost:3002`
- 운영 현재 상태: `npm run audit:blog-images -- --base=https://www.yeosonam.com`
- JSON 보고서가 필요하면 뒤에 `--json`을 붙인다.

### 100점 기준

- `score=100`
- `failed=0`
- `errors=0`
- 모든 글의 `imageCount>0`
- `broken=0`
- `missingAlt=0`
- `duplicate_within_post=0`
- `no_title_token_in_alt_or_caption=0`

### 엔진 기준

- 발행 전 `runQualityGates()`의 `image_quality` 게이트를 통과해야 한다.
- `image_quality`는 마크다운 원문 기준으로 최소 이미지 수, 빈 alt, generic alt, 중복 URL, 깨진 Pexels URL, 목적지/키워드 토큰 없는 alt/caption을 차단한다.
- Pexels 검색어는 `destToEnKeyword(destination)` + 섹션 힌트 조합을 사용한다. 목적지 매핑을 추가/수정하면 `src/lib/pexels.ts`와 이미지 감사 결과를 함께 확인한다.
- 시각적 의미 적합성은 자동 감사가 alt/caption/제목 토큰 기반으로 하한선을 잡는다. 신규 목적지나 대량 발행 전에는 실패 예시와 상위 샘플을 사람이 추가 확인한다.
- 2026-06-07 로컬 개선판 기준 이미지 감사 결과: 99개 글 전부 통과(`score=100`, `failed=0`, `errors=0`, `totalImages=299`). 이미지 출처는 Pexels 295장, Supabase blog-assets 4장이다. 전체 중복률은 `duplicateImageRatio=0.361`이므로 글 안 중복은 금지하고, 새 생성 엔진은 Pexels 결과 페이지/사진 인덱스를 주제 seed로 분산한다.

---

## Blog SEO Quality Audit (2026-06-07)

렌더링과 이미지가 정상이어도 SEO 메타, canonical, 구조화 데이터, H1/H2, 내부링크, 롱테일 제목 구성이 약하면 상위노출 품질로 보지 않는다. 새 글 발행 전에는 `computeSeoScore()`가 100점 만점 기준을 통과해야 하며, 배포 전에는 실제 페이지 DOM 기준의 SEO 감사를 별도로 실행한다.

### 필수 명령

- 배포 전 로컬: `npm run audit:blog-seo -- --base=http://localhost:3002`
- 운영 현재 상태: `npm run audit:blog-seo -- --base=https://www.yeosonam.com`
- JSON 보고서가 필요하면 뒤에 `--json`을 붙인다.

### 100점 기준

- `score=100`
- `failed=0`
- `errors=0`
- 모든 공개 글에 title, meta description, canonical, OG/Twitter 메타가 있어야 한다.
- 모든 공개 글은 `noindex`가 없어야 하고 canonical path가 실제 slug와 일치해야 한다.
- 모든 공개 글은 문서 전체 기준 H1 1개, H2 3개 이상, 본문 1,200자 이상이어야 한다.
- 모든 공개 글은 본문 이미지 2장 이상, 빈 alt 0개, OG image 1개 이상이어야 한다.
- 모든 공개 글은 BlogPosting 또는 Article JSON-LD와 BreadcrumbList JSON-LD를 가져야 한다.
- 모든 공개 글은 내부링크 1개 이상을 가져야 한다.

### 상위노출 경고 기준

- `weak_longtail_modifier`: 제목/H1에 비용, 가격, 일정, 코스, 날씨, 월별, 준비물, 체크리스트, 환전, 입국, 서류, 항공권, 숙소, 맛집, 추천, 가이드, 후기, 예약, 포함, 주의, 연도형 키워드가 없으면 경고로 남긴다. 실패는 아니지만 GSC 롱테일 확장 후보나 수동 개선 후보로 본다.
- `short_title`: 한국어 제목이 20자 이상이면 기술 실패는 아니지만, 25자 미만이면 CTR 개선 후보로 본다.
- `below_info_blog_ideal_length`: 본문 1,200자는 색인 최소선이고, 정보성 글은 2,500자 이상을 이상 기준으로 본다.
- `missing_external_authority_link`: 공식 출처 링크가 없으면 경고로 남긴다. 비자, 입국, 날씨, 안전, 공항, 환율 글은 공식 출처 링크를 강제하는 쪽을 우선한다.

### 발행 엔진 기준

- `src/lib/blog-seo-scorer.ts`의 `computeSeoScore()`는 100점 만점이다.
- 자동 발행 기준은 정보성 글 85점 이상, 상품형 글 80점 이상이다.
- title, meta description, heading, image SEO, 내부링크/CTA, structured data, helpful content 항목 중 critical fail이 있으면 점수가 높아도 발행하지 않는다.
- `blog-publisher`는 `blog_topic_queue.meta.keywords`를 `secondaryKeywords`로 넘겨 롱테일/보조 키워드 커버리지를 채점한다.
- 새 글 발행, 수동 발행/재발행, 강제 재검증, 크론 발행은 `notifyIndexing()` 또는 batch indexing 경로로 sitemap 제출과 IndexNow를 요청한다.
- `/sitemap.xml` is a public crawler entry point. It must stay cached with `revalidate = 3600`, must not use `dynamic = 'force-dynamic'`, and must abort package/destination/blog Supabase reads quickly. If Supabase REST is degraded, sitemap should return the static public routes instead of holding three long DB reads open.
- Public blog list/detail/destination/angle render paths must use a real response timer (`Promise.race`) in addition to `AbortController`. A stuck Supabase REST request can ignore abort long enough to hold the whole page open.
- `revalidatePublicBlogCache()` must invalidate `/sitemap.xml` whenever a public blog post is published, archived, regenerated, reindexed, or feature-state changed, so caching does not hide fresh public URLs after recovery.
- 기존 글의 렌더러/SEO 시스템 수정 후에는 배포 직후 `/api/blog/bulk-reindex`를 실행해 전체 블로그를 재검증/재색인한다.

### 현재 확인 결과

- 2026-06-07 로컬 전체 99개 SEO 감사 결과: `score=100`, `passed=99`, `failed=0`, `errors=0`, `warnings=115`.
- 주요 경고: `short_title`, `duplicate_meta_description`, `weak_longtail_modifier`, `missing_external_authority_link`. 이 경고는 색인 차단 사유는 아니지만, 롱테일 제목/메타/공신력 링크 개선 후보로 관리한다.

---

## Blog Visual 100 Gate (2026-06-08)

사용자 화면의 실제 깨짐은 DOM/URL 감사만으로 충분히 잡히지 않는다. 블로그 배포 전에는 실제 브라우저 viewport 기준의 visual audit을 반드시 실행한다.

### 필수 명령

- 배포 전 로컬: `npm run audit:blog-visual -- --base=http://localhost:3002 --full --strict`
- 운영 배포 후: `npm run audit:blog-visual -- --base=https://www.yeosonam.com --full --strict`
- 빠른 표본 점검: `npm run audit:blog-visual -- --base=http://localhost:3002 --limit=3 --surface-limit=3 --json`

### 100점 기준

- `score=100`
- `failed=0`
- 목록/탭 카드의 실제 표시 이미지가 0px, 깨진 이미지, generic `/og-image.png`로 남지 않아야 한다.
- 본문에 `![이미지](url)`, `##`, `[링크](url)`, `|---|`, `~~취소선~~` 원문이 보이면 실패다.
- `<del>`, `<s>`, `<strike>`, `.line-through`가 블로그 본문에 노출되면 실패다.
- 모바일에서 table이 article container 또는 viewport를 밀면 실패다.
- horizontal overflow가 발생하면 실패다.
- 본문 heading은 generated text를 담으므로 unwrapped flex layout을 금지한다. 번호 배지가 필요하면 `h2::before`를 inline/block flow 안에서 배치하고, 제목 텍스트는 자연 줄바꿈되어야 한다.

### 이미지 배치 기준

- 카드 `og_image_url`이 비었거나 `/og-image.png`이면 본문 첫 실제 이미지를 카드 썸네일로 승격한다.
- 새 글 생성 엔진은 본문 이미지 2장 이상, 카드 이미지 1장 이상, alt 3자 이상, 글 제목/목적지와 연결되는 alt/caption을 만들어야 한다.
- Pexels는 기본 공급원일 뿐이다. 주제 적합성이 약하면 Wikimedia Commons, 공식 관광청/공항/날씨/비자/입국 안내 등 라이선스와 출처가 확인되는 외부 리소스를 후보로 둔다.
- 기본 OG 이미지는 최후 fallback이며 공개 카드 품질 통과 이미지로 보지 않는다.

### GSC / 도메인 기준

- Google Search Console에 Domain property와 `https://www.yeosonam.com/`, `https://yeosonam.com/` URL-prefix property가 공존하는 것은 문제 자체가 아니다.
- 자동화와 sitemap 기준 canonical origin은 `https://www.yeosonam.com` 하나로 고정한다.
- 배포 전후 `npm run audit:blog-gsc-domain -- --strict`를 실행해 redirect, canonical, `og:url`, sitemap origin을 확인한다.
- `GSC_SITE_URL`을 설정할 때는 `https://www.yeosonam.com/` URL-prefix property와 서비스 계정 권한이 맞는지 확인한다.
- 수정 후 색인 요청은 visual/render/image/SEO/GSC 감사가 모두 통과한 뒤 실행한다.

### 왜 2026-06-08 이전 감사가 부족했나

- 기존 `audit:blog-render`, `audit:blog-images`, `audit:blog-seo`는 DOM과 URL 중심이라 삭제선, 모바일 표 overflow, 실제 viewport horizontal overflow를 놓쳤다.
- lazy image는 스크롤 전에 검사하면 깨진 이미지처럼 보일 수 있다. `audit:blog-visual`은 페이지를 스크롤한 뒤 이미지 로딩을 판정한다.
- `.prose-blog h2` 같은 typography wrapper를 `display:flex`로 만들면, 긴 FAQ/본문 텍스트와 `.num` 강조가 flex item으로 분리되어 모바일 페이지 폭을 밀 수 있다.
- 이전 세션 작업은 main이 아닌 기능 브랜치에서 진행된 흔적이 있어, 블로그 복구 작업은 반드시 `origin/main` 기준 새 브랜치에서 시작한다.

---

## Blog Structure Integrity Gate (2026-06-09)

렌더링, 이미지 URL, SEO 점수가 정상이어도 본문 의미 구조가 깨지면 발행 실패다. 특히 `/blog/zhangjiajie-weather`에서 확인된 것처럼 `<table>` 안에 설명 문단이 들어가고 나머지 셀이 빈 상태, `:::` 원시 directive, 중복 핵심 요약, 접힌 FAQ/체크리스트, 정보글에 상품 판매 어투가 섞인 상태는 고객 화면 품질 0점으로 본다.

### 발행 차단 기준

- `table_prose_contamination`: 표 행의 첫 칸이 긴 설명 문단이고 나머지 칸이 비어 있거나, `td` 안에 `aside`, `p`, `ul`, `ol`, `blockquote`, `:::`가 들어가면 실패다.
- `raw_directive_leak`: 렌더된 본문 텍스트에 `:::`가 보이면 실패다.
- `heading_shape_invalid`: FAQ 질문이나 번호형 본문이 H2/H3 제목 안으로 접히면 실패다.
- `duplicate_core_block`: `핵심 요약`, `자주 묻는 질문`, `FAQ`, `Q&A` 같은 핵심 블록이 중복되면 실패다.
- `checklist_shape_invalid`: 체크리스트/준비물/필수 아이템 섹션은 최소 3개 이상의 짧은 리스트 항목이어야 한다. 한 항목 안에 `2. ...` 같은 다음 섹션이 접히면 실패다.
- `content_type_tone_mismatch`: 날씨/옷차림/우기/기온 정보글에 `상품을 고른 이유`, `이 상품`, `특가`, `출발가` 같은 상품 판매 어투가 섞이면 실패다.

### 운영 규칙

- 새 글 발행 전 `runQualityGates()`의 `structure_integrity`가 `passed=true`여야 한다.
- 자동 발행, 수동 발행, 직접 `POST /api/blog`, 기존 글 백필 모두 `runQualityGates()`를 통과해야 한다. 실패하면 저장·발행·색인 요청을 진행하지 않는다.
- 이미지가 보이고 table overflow가 0이어도 `structure_integrity`가 실패하면 차단한다.
- 실패 원문은 글을 수동으로 고치는 것보다 생성 프롬프트/Markdown 정규화/본문 블록 조립기를 먼저 고친다.
- 같은 오류가 재발하면 `docs/errors/blog.md`의 `ERR-BLOG-structure-contamination@2026-06-09` 항목에 증상과 회귀 테스트를 추가한다.
---

## Blog Publish Quality Gate (2026-06-09)

Public publishing must use one shared gate: `evaluateBlogPublishQuality()` in `src/lib/blog-publish-quality.ts`.

### Mandatory Covered Paths

- `POST /api/blog` with `status='published'`
- `PATCH /api/blog` when changing to `status='published'`
- `POST /api/content-queue` approve action
- `POST /api/content-hub/publish` for `published` or `manually_published`
- `publishDistribution(... platform='blog_body')` when it flips an existing blog post to published
- `POST /api/blog/mrt-hotel-ranking` when `publish !== false`
- `scripts/backfill-blog-quality.ts --write`
- `GET /api/cron/blog-regenerate-zero-click` when replacing a published post body

### Required Stored Evidence

Every path above must store all of these fields together before the post is public or re-indexed:

- `quality_gate`
- `seo_score`
- `readability_score`
- `readability_issues`

### Blocking Rule

If either `quality_gate.passed` or `seo_score.passed` is false, the publishing path must return `422` or a failed distribution result. It must not update `status`, must not call `notifyIndexing()`, and must not revalidate the public blog URL as a successful publish.

### Editorial Standard

SEO is not complete from metadata alone. The body must be readable, non-duplicative, table-safe on mobile, free of Markdown artifacts, and written in the correct intent for the article type. Direct-answer paragraphs, FAQ blocks, specific longtail modifiers, source-backed claims, internal links, and image alt text are all part of the publish gate.

---

## Blog Image Delivery Gate (2026-06-09)

External image URL reachability is not enough. A URL can return `200` in a server-side audit and still render as a broken image in a real browser because of client blocking, privacy extensions, CDN policy, or third-party host failures.

### Rule

- Public blog HTML must not expose `https://images.pexels.com/...` directly to the reader viewport.
- Rendered article HTML, blog listing cards, angle tabs, destination tabs, related posts, previous/next cards, metadata images, and JSON-LD image fields must use `toBlogImageDisplaySrc()` for proxyable blog images.
- The only approved runtime delivery path for Pexels blog images is `/api/blog/image?src=...`.
- `/api/blog/image` must allowlist hosts. Do not turn it into an open proxy.
- Visual QA must check browser-loaded `naturalWidth/naturalHeight` and visible box height. HTTP `200`, `<img>` count, or non-empty `src` is not sufficient.

### Verification

- Unit: `npx vitest run src/lib/blog-image-proxy.test.ts src/lib/blog-renderer.test.ts`
- Local endpoint: open `/api/blog/image?src=<encoded pexels url>` and confirm the browser image has non-zero natural dimensions.
- Production: `npm run audit:blog-visual -- --base=https://www.yeosonam.com --full --strict --json` must report `visible_broken_or_tiny_images=0`.

---

## Blog Editorial Intent Gate (2026-06-09)

Render, image, and metadata audits are not enough. A post can score 100 on those checks and still be bad if the writing intent is wrong, the article is wall-of-text, a weather guide contains sales copy, or a preparation guide has no checklist.

### Required Gate

- Every public publish path must pass `runQualityGates()` with `intent_quality.passed=true`.
- The gate is implemented in `src/lib/blog-content-intent.ts` and connected through `src/lib/blog-quality-gate.ts`.
- Production-wide audit command: `npm run audit:blog-editorial -- --base=https://www.yeosonam.com --strict`.

### Intent Contracts

- Weather info: monthly/season table, clothing checklist, rainy/season risk, best timing, FAQ.
- Preparation info: at least five checklist items, documents/money/connectivity/medicine grouping, warning/tip block.
- Itinerary info: day-by-day or time-by-time route, movement time, rest point, budget note.
- Visa/currency/transport info: at least one authoritative external source link because the facts change.
- Product/package content: itinerary/value proof, included/excluded, price/departure facts, reader-fit explanation, CTA.

### Reading Design Contract

- No paragraph wall: long paragraphs are a failure, not a style preference.
- At least four H2 sections.
- Real list or table structure for scanning.
- Use `==highlight==`, numeric facts, and tip/warn boxes where useful.
- Informational posts must not contain product-sales headings such as "이 상품을 고른 이유", "특가", "출발가", or "예약 마감" unless the post is explicitly hybrid/product.

### Learning Loop

- When `audit:blog-editorial` finds a repeated issue, add or update a regression test in `src/lib/blog-content-intent.test.ts`.
- Add the incident to `docs/errors/blog.md` and, if current, `db/error-registry.md`.
- Prompt changes are not enough. Each promoted lesson needs one of: deterministic classifier rule, publish gate, audit script check, or fixture test.
- This follows Google Search Central guidance: helpful, reliable, people-first content is required regardless of whether AI assisted the writing; scaled low-value automation must be blocked.

### Editorial Auto-Repair Layer

Use `src/lib/blog-editorial-repair.ts` for safe deterministic repairs before publishing or backfilling old posts.

Allowed automatic repairs:

- informational sales wording -> neutral informational wording
- missing weather table -> non-fabricated monthly checklist table
- visa/currency/transport source gap -> official reference block
- preparation checklist under five items -> practical checklist supplement
- paragraph wall -> sentence-group paragraph split
- weak reading design -> tip box supplement

Not allowed:

- inventing exact temperatures, prices, flight times, opening hours, review scores, or first-hand experience
- deleting canonical URLs to hide bad historical posts
- reindexing a repaired post before `evaluateBlogPublishQuality()` passes

Verification:

- Current production without repair preview may expose historical content debt.
- Repair preview command: `npm run audit:blog-editorial -- --base=https://www.yeosonam.com --repair-preview --json`
- 2026-06-09 result after this repair layer: 101/101 passed, average editorial score 100.
- Dry-run path for existing posts: `npm run backfill:blog-quality -- --limit=120`.
- Write path for existing posts: `npm run backfill:blog-quality:write -- --limit=120` after dry-run review and backup.

### Legacy Backfill Safety Status

Do not run the write command just because editorial repair preview is 100/100. Preview only proves the intent repair layer can make article text acceptable for the editorial audit; the DB write path must also pass the full publish gate: render integrity, structure integrity, image quality, SEO, CTA/internal links, and readability.

2026-06-10 backfill dry-run findings:

- `npm run backfill:blog-quality -- --limit=10`: 10 scanned, 0 quality-gate failures after renderer/backfill safety fixes.
- `npm run backfill:blog-quality -- --limit=120`: 101 scanned, 0 quality-gate failures after legacy renderer/backfill repair hardening.
- The repair path now covers loose markdown images, residual linked-image markdown, HTML-stored headings, collapsed FAQ blocks, weather tables, itinerary tables, official reference links, info/product tone mismatch, weak SEO title/description, and longtail coverage.
- `backfill:blog-quality:write` is allowed only after the same full dry-run still reports `qualityGateFailed=0`; immediately re-run render/image/SEO/editorial/revenue audits and bulk reindex after write.

The dry-run summary must include `failedSamples.failedGates` evidence. A one-line failure reason is not enough for future learning.

External basis:

- Google Search Central "helpful, reliable, people-first content": automation is acceptable only when the result is useful and transparent. https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google Search guidance on AI-generated content: AI assistance is not the issue; usefulness, originality, and quality are. https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- Google Search spam policies: scaled content without added value must be blocked. https://developers.google.com/search/docs/essentials/spam-policies
- Google SEO Starter Guide: useful content, descriptive links, images/alt, and crawlable structure are a combined quality surface. https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- Google structured data docs: Article/FAQ schema is support, not a substitute for useful visible content. https://developers.google.com/search/docs/appearance/structured-data/article

---

## Blog Revenue Funnel Gate (2026-06-09)

SEO 100 is not complete if the blog does not move qualified readers toward sellable travel products. Blog quality is now judged by two independent scores:

- Content quality: render, image, visual, SEO, structure, editorial intent.
- Revenue funnel readiness: article-intent-aware product recommendations, product impression/click/inquiry/booking tracking, and learning feedback.

### Required Command

- Current codebase audit: `npm run audit:blog-revenue-funnel`
- JSON output: `npm run audit:blog-revenue-funnel -- --json`
- Strict release gate after implementation: `npm run audit:blog-revenue-funnel -- --strict`

### 100-Point Standard

- Information posts must use `post.destination` as a fallback for product recommendations.
- Blog product cards must use `package_scores`, `recommendBestPackages()`, or an equivalent scoring policy, not price-only sorting. Public blog render paths should prefer bounded `package_scores` reads and use price sorting only as a short-timeout fallback; heavy real-time scoring belongs in jobs or APIs, not the reader page render path.
- `recommendation_outcomes.source` must support `blog`.
- Product impressions from blog cards must record `content_creative_id`, `package_id`, rank, intent, policy id, and session id.
- Product clicks must capture the clicked `package_id`, not only a boolean CTA click.
- Package inquiry and booking paths must update recommendation outcomes/events when the session came from a blog product recommendation.
- Daily publishing must alert or repair if fewer than 3 posts were published the previous day.
- `blog-learn` must consume both editorial failures and recommendation funnel outcomes before claiming self-improvement.

### Operating Rule

Existing posts should be improved in batches, not mass-deleted or blindly regenerated. Prioritize posts with GSC potential, editorial failures, active sellable products, engagement/CTA opportunity, and seasonal freshness risk. After meaningful changes, keep the canonical URL when possible, update `lastmod`, run all blog audits, then request reindexing through the existing bulk reindex path.

### Current Baseline

2026-06-09 initial code audit result: `43/100` revenue funnel readiness. Post-implementation result: `100/100` by `npm run audit:blog-revenue-funnel -- --strict`. Evidence: `docs/audits/2026-06-09-blog-revenue-funnel-code-research.md`.

---

## Search Indexability Gate (2026-06-10)

Google Search Console and Naver Search Advisor reports are not satisfied by successful submission alone. A URL must be crawlable, indexable, canonical-clean, and title-distinct before reindexing.

Required command:

- `npm run audit:site-indexability -- --base=https://www.yeosonam.com --strict`

This gate fails on sitemap URLs with:

- robots.txt blocking
- `noindex`
- 3xx/4xx/5xx responses
- missing title or canonical
- canonical mismatch
- duplicate title among indexable sitemap URLs

Sitemap rules:

- Do not include `/rfq/*`, `/share/*`, `/auth/*`, `/admin/*`, or other private/action URLs.
- Do not include filter/search URLs such as `/packages?destination=...` when their canonical is `/packages`.
- Blog destination hubs must come from a real destination field, not a slug prefix such as `5월`, `6월`, or `여름방학`.
- A sitemap URL's canonical must point to itself after normal trailing-slash normalization.
- Product detail titles must include enough differentiators such as product type, price, or product id suffix when many package rows share the same supplier title.

After fixing indexability issues:

1. Deploy.
2. Run `npm run audit:site-indexability -- --base=https://www.yeosonam.com --strict`.
3. Run `/api/blog/bulk-reindex` or the relevant sitemap submission path.
4. In Google Search Console/Naver Search Advisor, start validation only after the live audit is clean.
