# Blog SERP·keyword research V3 운영 런북

## 목적과 공급자 계약

생성 엔진은 유료 Google SERP API를 필수로 요구하지 않습니다. 기본 입력은 아래 순서로 사용하며 각 수치의 의미를 섞지 않습니다.

1. Naver Search Ads Keyword Tool: PC·mobile 월간 검색수. 광고 계정 API license가 있어야 하며 `"< 10"`은 정확한 숫자로 변환하지 않습니다.
2. Naver DataLab: 기간 내 상대 검색 추이 0~100. 월간 검색량으로 환산하지 않습니다.
3. Naver Search API blog/web: editorial 문서의 제목·snippet·URL 표본. Google 순위나 Naver 통합검색 순위의 대체값이 아닙니다.
4. Google Search Console: 여소남의 실제 query/page impressions·clicks·CTR·position.
5. 실제 고객 질문, 활성 상품 질문, 검증된 운영자 노트, 편집 승인 seed.

Naver Search API 표본은 검색 의도와 의사결정 구조를 찾는 데만 사용합니다. 경쟁사 본문 전체를 저장하거나 writer prompt에 전달하지 않고, 문장·목차·사실을 복제하지 않습니다. 외부 사실은 별도의 공식 source/claim gate를 통과해야 합니다.

## 환경 변수

| 변수 | 역할 | 누락 시 동작 |
|---|---|---|
| `NAVER_CLIENT_ID` | Search API·DataLab client ID | Naver Search/DataLab을 `unconfigured`로 기록 |
| `NAVER_CLIENT_SECRET` | Search API·DataLab secret | 동일 |
| `NAVER_ADS_API_KEY` | Search Ads API license | 월간 검색량을 `null`로 유지 |
| `NAVER_ADS_SECRET_KEY` | Search Ads HMAC secret | 월간 검색량을 `null`로 유지 |
| `NAVER_ADS_CUSTOMER_ID` | Search Ads advertiser customer | 월간 검색량을 `null`로 유지 |
| `SERPAPI_KEY` | 기존 선택형 순위 추적 | 생성 V3에서는 사용하지 않으며 필수 아님 |

비밀값은 client bundle, audit JSON, 로그에 출력하지 않습니다. 격리 worktree 감사는 비밀파일을 복사하지 않고 `BLOG_AUDIT_ENV_DIR`로 이미 설정된 로컬 프로젝트 디렉터리만 지정할 수 있습니다. 이 변수는 로컬 감사용이며 Vercel 상시 환경 변수로 설정하지 않습니다.

## 수집과 판정

```powershell
npm run audit:blog-serp-v3
```

기본 실행은 read-only/dry-run입니다. 24개 query × 최대 10개 editorial 표본을 수집하고 다음 파일을 생성합니다.

- `docs/audits/blog-serp-benchmark-2026-08-14.md`
- `docs/audits/blog-serp-benchmark-2026-08-14.json`
- `docs/audits/blog-serp-benchmark-results-2026-08-14.csv`

HTTP 401/403/429, robots 또는 timeout은 `fetch_blocked`, 그 외 실패는 `fetch_failed`로 기록합니다. 빈 provider 응답, 0 DataLab 지수, 설정되지 않은 API는 수요 성공이 아닙니다. `--apply`는 migration이 적용된 승인 환경에서 research snapshot만 저장하는 옵션이며 production change window 밖에서는 실행하지 않습니다.

## 생성 fallback

연구 모드는 `fresh`, `cached`, `fallback_only`, `unavailable` 중 하나입니다.

- Naver editorial 표본이 있으면 `fresh`입니다.
- 표본은 없지만 Search Ads/DataLab/GSC의 양수 관측값이 있으면 `fallback_only`입니다.
- 모든 공급자가 비어 있으면 `unavailable`입니다.
- SERP 장애 자체는 공식 근거와 다른 검증 demand가 있는 LOW/MEDIUM 글을 차단하지 않습니다.
- claim 충돌, unsupported number, 중복/cannibalization, 깨진 한국어, 허위 경험, HIGH-risk 승인 누락은 항상 차단합니다.

한 슬롯에서 후보는 최대 8개, 한 queue item의 durable 생성 시도는 최대 3회입니다. claim fingerprint가 같은 범위에서만 표현·구조를 다시 작성하며 사실과 숫자를 deterministic repair로 만들지 않습니다.

## 첫 운영 후보와 대표글 처리

큐에 아래 후보가 있으면 순서를 고정합니다.

1. `다낭 10월 날씨`
2. `다낭 가볼만한곳`
3. `세부 호텔 추천`

`다낭 여행` 같은 broad destination query는 새 URL로 발행하지 않고 기존 representative/canonical article의 material refresh 대상으로 보냅니다. 이 세 후보 역시 이미 같은 intent의 대표글이 있으면 새 URL을 만들지 않습니다.

## migration·rollback

- migration: `supabase/migrations/20260813223117_blog_naver_first_serp_research_v3.sql`
- rollback: `supabase/rollbacks/20260813223117_blog_naver_first_serp_research_v3_rollback.sql`
- read-only backfill review: `supabase/backfills/20260813223117_blog_naver_first_serp_research_v3_dry_run.sql`

세 신규 테이블은 RLS를 켜고 anon/authenticated/public 권한을 revoke한 service-role 전용입니다. migration은 additive이며 기존 `serp_snapshots`, `serp_analysis` reader와 호환됩니다. 운영 적용 전에 data-free Supabase preview에서 migration → RLS/sequence ACL → contract test → rollback → 재적용 순으로 검증합니다.

구형 snapshot은 제목 빈도·power word 중심 분석이라 V3 decision research로 자동 이관하지 않습니다. backfill 검토 SQL은 legacy row 수와 최신성만 SELECT하고 승인 이관 수를 0건으로 보고합니다. migration 이후 24개 기준 query부터 fresh research를 다시 저장합니다.
