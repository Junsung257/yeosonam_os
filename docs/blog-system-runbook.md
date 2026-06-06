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
