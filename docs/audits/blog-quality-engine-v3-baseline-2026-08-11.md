# Blog Quality Engine V3 baseline — 2026-08-11

기준 시간대는 Asia/Seoul입니다. 운영 Supabase에는 SELECT만 실행했고 migration, UPDATE, DELETE는 실행하지 않았습니다.

## Source of truth

- 작업 기준: `origin/main` = `2718bc37fc6c0ee382624ea0d7dfd722ef878ed2`, production commit = `not_supplied`
- 격리 branch: `codex/blog-quality-engine-v3-20260811`
- lockfile: `package-lock.json`, Next.js `15.5.21`
- 운영 배포가 feature branch commit을 직접 사용한 이력이 있어, main 병합 후 immutable commit을 promote하고 branch-name deploy를 금지하는 runbook 절차가 필요합니다.

## 현재 재계산

- 발행 200, 정보성 198, 상품 연결 2
- 현재 SQL view 공개 가능 192
- exact duplicate title 19 groups / 42 rows
- V3 normalized title skeleton(3+) 20 groups / 187 rows
- SEO 평균 96.74, 95 이상 191, readability 100 200
- queue 13, 검색량 null 13, trend null 13
- 측정 row: rank_history 1472, blog_search_metrics 13, analytics_server_events 0
- field p75: LCP 10168ms, INP 128ms, CLS 0.00028678445698302466 (표본은 JSON 참조)

## 감사 버전 차이

미션 입력 감사의 기준값(제목 골격 16/148, 이미지 596회 중 Pexels 582회, queued 11)은 JSON에 보존했습니다. 현재 DB 시점과 V3 parser 결과는 별도 필드이며 과거 수치를 덮어쓰지 않습니다.

## 재현 명령과 SQL

`npx tsx scripts/audit-blog-corpus-v3.ts`

`select count(*) from content_creatives where channel='naver_blog' and status='published' and slug is not null;`

`select count(*) from public_blog_content_creatives;`

`select coalesce(review_status,'null'), count(*) from content_creatives where channel='naver_blog' and status='published' and slug is not null group by 1;`

모든 signature, URL, image host와 큐 row는 동명의 JSON에 있습니다.

## 과거 문서 검색

- `yeosonam_os_blog_seo_audit_2026-07-15.md`: 없음 (`rg --files` 검색)
- `yeosonam_info_engine_v2_goal_master_2026-07-15.md`: 없음 (`rg --files` 검색)
