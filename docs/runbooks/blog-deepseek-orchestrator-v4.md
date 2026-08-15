# Blog DeepSeek Orchestrator V4 Runbook

기준일: 2026-08-15 (Asia/Seoul)

이 런북은 블로그 후보 생성과 공개를 분리한다. 하루 30개는 후보 처리량이며 공개량이 아니다. 운영 공개는 품질·수요·증거·중복·포트폴리오 gate를 통과한 글만 3→5→10→최대 20건으로 단계 상승한다. 이번 변경은 운영 배포와 운영 DB migration을 수행하지 않는다.

## 실행 구조

1. `blog-generate`가 KST 01:05~06:05에 실행된다.
2. Naver API HUB → 기존 Naver Developers API → Search Ads/DataLab/GSC/공식 근거 순으로 수요와 구조 신호를 수집한다.
3. DeepSeek V4 Flash(non-thinking)가 첫 초안을 작성한다.
4. 기존 claim gate, V3 brief, corpus diversity, 한국어·이미지·공개 렌더 gate가 평가한다.
5. 90점 이상이고 hard blocker와 failure가 모두 0이면 `approved_for_slot`이다.
6. 75~89점은 DeepSeek V4 Pro `reasoning_effort=high`, 75점 미만의 표현·완결성 실패는 Pro `max`로 재작성한다.
7. 사실·수요·claim 충돌은 문장 재작성으로 덮지 않는다. 한 번 재연구 후 계속 실패하면 격리한다.
8. 한 후보의 모델 호출은 초안을 포함해 최대 3회다. 두 번째 재작성 가능 실패가 미수렴이면 승인 claim만 사용하는 Pro max 최종 시도를 수행하며, 세 번째 완료 후에도 실패할 때만 격리한다. 연구·수요·비재작성 hard blocker는 즉시 안전 보류할 수 있다.
9. `blog-publication-controller`가 KST 09/12/15/18/21에 저장된 승인 초안만 공개한다. 이 route의 모델 호출 수는 0이다.
10. 공개 후 기존 atomic representative, indexing outbox, public snapshot, cache tag 경로를 사용한다.

생성 실행 원장은 `blog_generation_runs`, 개별 모델 시도는 `blog_generation_attempts`, 가격 근거는 `ai_model_price_catalog`에 저장한다. 기존 `agent_tasks`에는 queue별 `blog_orchestrator` 작업 한 건을 재사용해 stage와 최종 disposition을 남긴다.

## DeepSeek 시간·가격 계약

DeepSeek 공식 가격 변경 시점은 2026-08-16 16:00 UTC(2026-08-17 01:00 KST)다. 이후 공식 peak는 UTC 01:00–04:00, 06:00–10:00, 즉 KST 10:00–13:00, 15:00–19:00다. 그 외 시간은 off-peak이며 현재 공시상 peak의 절반이다.

| 모델 | tier | cache hit | cache miss | output (USD / 1M tokens) |
|---|---:|---:|---:|---:|
| V4 Flash | off-peak | 0.007 | 0.22 | 0.66 |
| V4 Flash | peak | 0.014 | 0.44 | 1.32 |
| V4 Pro | off-peak | 0.022 | 0.66 | 1.98 |
| V4 Pro | peak | 0.044 | 1.32 | 3.96 |

공식 근거: [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing), [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode).

코드는 호출 완료 시각과 cache hit/miss/output 토큰을 따로 기록한다. 알 수 없는 모델에 Flash의 싼 단가를 적용하지 않고 오류로 처리한다. 가격 변경 시 migration catalog와 `resolveDeepSeekPriceV4`를 같은 변경에서 갱신한다.

## 모델 역할

- `draft_flash`: `deepseek-v4-flash`, thinking disabled. 검증된 연구 packet 안에서 초안을 빠르게 만든다.
- `rewrite_pro_high`: `deepseek-v4-pro`, thinking enabled/high. 75~89점의 구조·완결성 실패만 고친다.
- `rewrite_pro_max`: `deepseek-v4-pro`, thinking enabled/max. 앞선 시도가 미수렴한 경우 승인된 research claim만 사실 경계로 사용해 마지막 3차 초안을 구성한다.
- Gemini/GPT/Claude fallback은 블로그 V4에서 금지한다. DeepSeek 장애는 다음 off-peak 실행으로 재시도하고 공급자 변경으로 숨기지 않는다.

재작성 prompt에는 이전 초안, 실패 evidence, research fingerprint, claim fingerprint가 들어간다. 새 숫자·새 사실·새 경험·새 출처 추가를 금지한다.

## 수요와 Naver fallback

`NAVER_API_HUB_CLIENT_ID`와 `NAVER_API_HUB_CLIENT_SECRET`이 있으면 다음 endpoint를 먼저 쓴다.

- `https://naverapihub.apigw.ntruss.com/search/v1/blog`
- `https://naverapihub.apigw.ntruss.com/search/v1/webkr`

HUB가 429/5xx/network 오류면 `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`의 기존 Developers Search API를 시도한다. 둘 다 없거나 비어 있으면 성공으로 기록하지 않는다. Search Ads 월간 검색량, DataLab 상대 추세, GSC 관측값은 서로 다른 단위로 보존하며 임의 숫자로 합성하지 않는다. SERP가 없어도 검증된 고객 질문, 활성 상품 질문, editor seed, GSC/Naver demand와 공식 근거가 있으면 진행할 수 있다.

## 여소남 홍보 계약

모든 본문에 동일 상품 문단을 삽입하지 않는다. 기존 `blog-informational-cta`의 intent 기반 중앙 CTA를 재사용한다.

- 호텔 지역·공항 이동처럼 상담 가치가 높은 의도: 검증된 상담 CTA 우선
- 예산·상품 비교 의도: 현재 판매 가능한 상품/딜 경로 우선
- 날씨·일반 준비: 관련 목적지 글을 우선하고 상담은 보조
- HIGH risk: 공식 출처와 관련 글만 표시하고 판매 CTA 제거
- 본문 안의 모델 생성 판매 링크는 제거하고 렌더러가 추적 가능한 중앙 CTA만 붙인다.

## 환경 변수와 안전한 승격

```text
DEEPSEEK_API_KEY=<server-only>
NAVER_API_HUB_CLIENT_ID=<server-only>
NAVER_API_HUB_CLIENT_SECRET=<server-only>
BLOG_DAILY_CANDIDATE_CAP=30
BLOG_AUTOPUBLISH_MODE=draft_only
BLOG_DAILY_PUBLISH_CAP=3
BLOG_PUBLICATION_RAMP_STAGE=pilot_3
BLOG_REQUIRE_DEMAND_SIGNAL=true
BLOG_MAX_WEATHER_SHARE_30D=0.20
BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10=2
```

처음에는 반드시 `draft_only`다. migration과 canary 검증 후에만 `live`로 바꾼다. `BLOG_DAILY_PUBLISH_CAP=20`을 미리 넣어도 기본 `pilot_3`가 실효 상한을 3으로 제한한다.

승격은 자동이 아니다.

| 단계 | 최소 관찰 | 다음 단계 조건 |
|---|---:|---|
| pilot_3 | 7일 | 공개 정정 0, duplicate/cannibalization 신규 0, HIGH 자동공개 0, controller 실패 0 |
| ramp_5 | 7일 | 위 조건 + 인덱싱 오류율 5% 이하, 품질 거절 원인 분포 확인 |
| ramp_10 | 14일 | 위 조건 + 28일 검색 데이터가 수집되고 zero-impression URL 추가생성 방지 확인 |
| max_20 | 지속 | field data와 편집 capacity가 감당할 때만. 20은 상한이지 목표/보장이 아님 |

## 운영 조회

```sql
-- 오늘 생성·재작성 결과
select status, count(*), min(latest_quality_score), avg(latest_quality_score), max(latest_quality_score)
from public.blog_generation_runs
where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
group by status;

-- 모델·가격대·비용
select model, pricing_tier, count(*), sum(input_tokens), sum(output_tokens), sum(estimated_cost_usd)
from public.blog_generation_attempts
where completed_at >= now() - interval '7 days'
group by model, pricing_tier;

-- 공개 대기열의 hard blocker 재확인
select r.id, r.queue_id, r.content_creative_id, r.latest_quality_score,
       a.hard_blockers, a.failure_reasons, r.scheduled_publish_at
from public.blog_generation_runs r
join lateral (
  select hard_blockers, failure_reasons
  from public.blog_generation_attempts a
  where a.run_id = r.id
  order by attempt_number desc limit 1
) a on true
where r.status = 'approved_for_slot';
```

## 적용 순서

1. 앱 코드를 배포하지 않은 상태에서 migration SQL을 preview DB에 적용한다.
2. dry-run query와 RLS를 검증한다. `anon`/`authenticated`는 세 테이블을 읽을 수 없어야 한다.
3. Preview Vercel에 DeepSeek/Naver server-only secret과 `BLOG_AUTOPUBLISH_MODE=draft_only`를 설정한다.
4. `blog-generate`를 수동 한 번 실행해 Flash receipt, attempt, agent task, private draft를 확인한다.
   - 운영 시간 밖의 preview 수동 검증만 `?force=true`를 사용한다. 정기 cron은 시간 창을 우회하지 않는다.
5. 75~89, 75 미만, hard blocker fixture로 Pro high/max, 재연구, 격리 분기를 확인한다.
6. publication controller를 draft-only에서 호출해 공개 0건을 확인한다.
7. preview에서 `live`, cap 3, `pilot_3`로 바꾸고 한 slot canary를 확인한다.
8. production migration → production code → secrets → draft-only canary 순으로 반영한다.
9. 승인 후에만 production `live`를 켠다. 기존 글 UPDATE나 migration backfill은 별도 승인 없이는 실행하지 않는다.

### 2026-08-16 preview 검증 기준

`draft_only` 실호출 canary는 다음을 동시에 만족해야 성공이다.

- latest attempt `route=approved_for_slot`, `finish_reason=stop`
- claim coverage 1.0, ledger declared/candidate 동일, unclassified 0
- hard blocker와 failure reason 모두 0
- creative `status=draft`, `published_at`과 `publish_scheduled_at` null
- public view 0, indexing job/report 0
- 상세 404, sitemap/RSS/image sitemap에 slug 없음

현재 증명된 queue는 `6fd9464c-cf2c-42c6-9ef4-1a9cd9fbe991`, deployment는 `dpl_GcnZ3JyrQdvMuEmwMMrhCFTvF9SE`다. 이는 preview 증거이며 production 활성화 근거로 단독 사용하지 않는다.

## 장애·롤백

- DeepSeek 장애: queue와 attempt 오류를 남기고 다음 off-peak로 재시도한다. 낮 시간 controller는 기존 승인 초안만 공개한다.
- Naver HUB 장애: legacy Developers API로 fallback한다. 두 경로가 모두 실패해도 검증된 다른 demand가 있으면 진행하고, 없으면 발행하지 않는다.
- controller가 공개 commit 전에 실패하면 creative는 draft로 남고 run을 격리한다. 공개 commit 뒤 bookkeeping만 실패하면 공개 글을 격리하지 않고 `published_state_sync_error`로 표시해 원장 동기화를 복구한다.
- 앱 롤백: 먼저 cron을 기존 publisher 경로로 되돌리고 `BLOG_AUTOPUBLISH_MODE=draft_only`로 전환한다.
- DB 롤백: 앱 롤백 후에만 migration 하단의 수동 rollback SQL을 실행한다. 원장은 삭제되므로 export와 승인 필요하다.
