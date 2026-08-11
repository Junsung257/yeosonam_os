# Blog Quality Engine V3 baseline — 2026-08-11

기준 시간대는 Asia/Seoul입니다. 운영 Supabase에는 연결된 read-only SQL만 실행했고 migration, INSERT, UPDATE, DELETE는 실행하지 않았습니다.

## 1. Source of truth

작업 시작 시 `origin/main`, 격리 worktree의 HEAD, 운영 Vercel commit은 모두 `2ab65ef05b4a0f9fff8564a9685de0047bc08860`이었습니다. 기준 lockfile은 `package-lock.json`, Next.js는 `15.5.21`입니다. 기존 작업 폴더의 미커밋 변경은 그대로 두고 `C:/dev/yeosonam-os-blog-quality-engine-v3`의 `codex/blog-quality-engine-v3-20260811` branch에서 작업했습니다.

운영 배포 metadata에 feature branch 이름이 남아 있는 문제는 재발 가능성이 있습니다. 운영은 main에 병합된 immutable commit만 promote하고, branch-name 기준 production deploy를 금지하며, 배포 전 `git merge-base --is-ancestor <production-commit> origin/main`을 필수 검사해야 합니다.

## 2. 운영 baseline

| 항목 | 현재 재조회 | 2026-08-11 미션 감사 기준 |
|---|---:|---:|
| slug 보유 전체 corpus | 270 | - |
| published | 200 | 200 |
| published 정보성 | 198 | 198 |
| 현행 public view 공개 가능 | 192 | 192 |
| exact duplicate title | 16그룹 / 34개 | 16그룹 / 34개 |
| SEO 평균 | 96.74 | 96.74 |
| SEO 95 이상 | 191개(정보성 189개) | 정보성 189개 |
| readability 100 | 200개(정보성 198개) | 정보성 198개 |
| active queue | 16개 | queued 날씨형 11개 |
| monthly volume null | 16/16 | 11/11 |
| trend null | 16/16 | 11/11 |

현행 active queue 16개에는 11개 coverage-gap 날씨 글 외에 pending review 2개와 user seed 3개가 포함됩니다. 이 모두에 검색량과 trend가 없으며, V3에서는 별도의 검증된 demand signal이 없는 한 발행되지 않습니다.

미션 감사의 정규화 결과는 제목 골격 16그룹/148개, checklist H2 198개, FAQ 185개, 공통 도입 141개입니다. 이미지 596회 중 582회가 `images.pexels.com`이었습니다. 이 값은 과거 비교 기준으로 JSON에 보존했고, V3 normalizer의 전체 corpus 재계산 결과와 혼합하지 않습니다.

## 3. 측정 상태

- `rank_history`: 1,334 rows
- `blog_search_metrics`: 13 rows
- `analytics_server_events`: 0 rows
- 최근 90일 field p75: LCP 3,552ms(목표 2,500ms 실패), INP 80ms(목표 통과), CLS 0.00755(목표 통과), TTFB 262.2ms

field LCP 목표는 아직 달성되지 않았습니다. analytics event는 데이터가 없으므로 콘텐츠 전환 성과도 확인할 수 없습니다.

## 4. 재현 SQL과 명령

```sql
select count(*) from content_creatives
where channel='naver_blog' and status='published' and slug is not null;

select count(*) from public_blog_content_creatives;

select coalesce(review_status::text,'null'), count(*)
from content_creatives
where channel='naver_blog' and status='published' and slug is not null
group by 1;

select coalesce(seo_title,title), count(*)
from content_creatives
where channel='naver_blog' and status='published' and slug is not null
group by 1 having count(*) > 1;

select topic,destination,source,status,monthly_search_volume,trend_score,product_id
from blog_topic_queue
where status in ('queued','generating','pending_review');
```

로컬 재현 명령은 `npx tsx scripts/audit-blog-corpus-v3.ts`와 `npx tsx scripts/plan-blog-corpus-disposition.ts`입니다. 현재 제공된 `.env.prod`는 dotenvx 암호화 placeholder이므로 로컬 실행에는 별도로 승인된 read-only 자격증명 또는 로컬 JSON export가 필요합니다. 이번 수치는 연결된 Supabase의 read-only SQL로 재확인했습니다.

## 5. 과거 감사 문서 검색

- `yeosonam_os_blog_seo_audit_2026-07-15.md`: `rg --files` 검색 결과 없음
- `yeosonam_info_engine_v2_goal_master_2026-07-15.md`: `rg --files` 검색 결과 없음

## 6. dry-run disposition

현재 270개 preview 결과는 KEEP 38, MERGE 147, QUARANTINE 23, NOINDEX 60, REFRESH 2입니다. 301 후보는 147개입니다. 이는 검색성과가 희박한 현행 corpus를 보수적으로 분류한 편집 검토용 계획이며 운영 DB에 적용하지 않았습니다. 각 row의 근거는 동명의 CSV/JSON과 redirect CSV에 있습니다.
