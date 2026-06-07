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
```bash
# 스타일 가이드 v1.0 prompt_versions 등록
node db/migrate_blog_autopublish_20260422.js
```

### 3. 첫 스케줄러 수동 실행
```bash
# Vercel 배포 직후, 첫 월요일 자동 실행 기다리지 말고:
curl https://yeosonam.com/api/cron/blog-scheduler
```
→ 17개 destination 중 Pillar 없는 곳 큐잉 + 42개 주간 토픽 충전

### 4. 첫 블로그 발행 수동 트리거
```bash
curl https://yeosonam.com/api/cron/blog-publisher
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
   - `blog-publisher` 는 `vercel.json` 기준 **UTC 매일 02:00** (배치당 최대 `MAX_BATCH`건) — 매시간이 아님
   - `blog-lifecycle` 이 매일 01:30 KST 실행 확인

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
curl https://yeosonam.com/api/cron/blog-publisher

# 3) GOOGLE_AI_API_KEY 쿼터 확인 (Gemini 콘솔)
```

### Pillar 페이지 빈 내용
- `/destinations/[city]` 접속 → "완벽 가이드가 곧 공개됩니다" 메시지만 뜸
- 원인: `blog-scheduler` 가 아직 Pillar 큐잉 안 함
- 해결:
  ```bash
  curl https://yeosonam.com/api/cron/blog-scheduler   # 큐잉
  curl https://yeosonam.com/api/cron/blog-publisher   # 즉시 생성
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
- 기존 글의 렌더러/SEO 시스템 수정 후에는 배포 직후 `/api/blog/bulk-reindex`를 실행해 전체 블로그를 재검증/재색인한다.

### 현재 확인 결과

- 2026-06-07 로컬 전체 99개 SEO 감사 결과: `score=100`, `passed=99`, `failed=0`, `errors=0`, `warnings=115`.
- 주요 경고: `short_title`, `duplicate_meta_description`, `weak_longtail_modifier`, `missing_external_authority_link`. 이 경고는 색인 차단 사유는 아니지만, 롱테일 제목/메타/공신력 링크 개선 후보로 관리한다.
