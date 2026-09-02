# Blog DeepSeek Orchestrator V4 Runbook

기준일: 2026-08-17 (Asia/Seoul)

이 런북은 블로그 후보 생성과 공개를 분리한다. 하루 30개는 후보 처리량이며 공개량이 아니다. 운영 공개는 품질·수요·증거·중복·포트폴리오 gate를 통과한 글만 `pilot_3→ramp_10→max_30`으로 단계 상승한다. 환경 변수는 상한일 뿐이고 실제 단계는 DB rollout 원장이 결정한다. 이 문서는 배포 절차를 정의하지만 문서 실행 자체가 운영 배포나 DB 변경을 승인하지 않는다.

## 실행 구조

1. `blog-generate`가 KST 01:05~06:05에 실행된다.
2. Naver API HUB → 기존 Naver Developers API → Search Ads/DataLab/GSC/공식 근거 순으로 수요와 구조 신호를 수집한다.
3. DeepSeek V4 Flash(non-thinking)가 첫 초안을 작성한다.
4. 기존 claim gate, V3 brief, corpus diversity, 한국어·이미지·공개 렌더 gate가 평가한다.
5. 90점 이상이고 hard blocker와 failure가 모두 0이면 `approved_for_slot`이다.
6. 75~89점은 DeepSeek V4 Pro `reasoning_effort=high`, 두 번째 시도까지 미수렴하면 Pro `max`를 최종 3차 시도로 사용한다.
7. 사실·수요·claim 충돌은 문장 재작성으로 덮지 않는다. 한 번 재연구 후 계속 실패하면 격리한다.
8. 75점 미만도 `researchValid=true`, `claimLedgerValid=true`, 남은 실패가 표현·구조뿐일 때에는 DeepSeek V4 Pro max 보완으로 계속 보낸다. 사실·수요·출처·충돌·언어 무결성·중복 문제는 재작성으로 우회하지 않는다. 한 후보의 writer 호출은 초안을 포함해 최대 5회(초안 1회 + 보완 4회)이며, 다섯 번째 결과도 사실·고위험·중복·claim gate를 통과하지 못하면 격리한다. 이 예산은 `20260818080000_blog_deepseek_auto_repair_budget_v1.sql` 적용 후에만 운영에서 활성화된다.
9. `blog-publication-controller`가 KST 09/12/15/18/21에 저장된 승인 초안만 공개한다. 이 route의 모델 호출 수는 0이다.
10. 공개 후 기존 atomic representative, indexing outbox, public snapshot, cache tag 경로를 사용한다.

### 기존 대표 글의 자동 갱신

- broad query 또는 동일 intent가 이미 활성 representative를 가지면 새 공개 URL을 만들지 않는다.
- 생성 단계는 기존 공개 행을 수정하지 않고 `--auto-<queue prefix>` 비공개 shadow draft를 만든다. 기존 공개 행의 ID, slug, `published_at`, status는 이 단계에서 불변이다.
- LOW/MEDIUM이며 `live` 정책, 수요, claim, 품질, 선택된 DeepSeek attempt가 모두 통과한 경우에만 `automated_published_replacement_v1` 계약을 기록한다.
- publication controller는 `replace_blog_information_automated_draft_atomically()` 안에서 run이 `publishing`인지, 선택 attempt가 DeepSeek/`stop`/90점 이상/차단 0인지, 본문·제목·description이 저장 초안과 같은지, 출력 slug가 기존 canonical과 같은지 다시 확인한다.
- 트랜잭션은 기존 canonical 행을 갱신하고 shadow draft를 archive하며 claim/evidence 소유권, representative, queue/run, `URL_UPDATED` indexing outbox, 전후 snapshot 원장을 한 번에 기록한다. 어느 검사나 write가 실패해도 기존 공개 글은 그대로 남는다.
- HIGH-risk 또는 `requires_human_review=true`는 이 함수를 사용할 수 없다. 기존 `reviewed_published_replacement_v1`과 사람 승인 RPC만 사용한다.
- 긴급 실전 검증은 cron 인증과 정확한 UUID를 함께 사용한 `blog-publication-controller?force=true&runId=<approved run UUID>`만 허용한다. 이 경로도 일일 cap을 우회하지 않으며 다른 승인 run을 처리하지 않는다.

생성 실행 원장은 `blog_generation_runs`, 개별 모델 시도는 `blog_generation_attempts`, 가격 근거는 `ai_model_price_catalog`, 호출 전 비용 예약은 `blog_ai_budget_reservations`에 저장한다. 승인된 run은 반드시 실제 저장된 `selected_attempt_id`를 가져야 한다. 기존 `agent_tasks`에는 queue별 `blog_orchestrator` 작업 한 건을 재사용해 stage와 최종 disposition을 남긴다.

모델 품질이 90점 이상이어도 `draft_only`, HIGH-risk, 사람 검토, 또는 발행 정책으로 공개할 수 없으면 run은 `approved_for_slot`에 남기지 않고 `human_review`로 전환하며 `scheduled_publish_at`을 비운다. 따라서 publication controller의 슬롯 재고는 실제 공개 가능한 초안만 포함한다.

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
- 자동 연구 구조화: 검토된 registry의 원문 URL을 직접 fetch한 뒤 `deepseek-v4-pro` JSON mode로만 claim packet을 구성한다. 원문이 없거나 fetch가 실패하면 발행하지 않는다.
- Gemini/GPT/Claude와 일반적인 공급자 fallback은 블로그 V4에서 금지한다. DeepSeek 장애나 사실 문제는 다른 모델로 숨기지 않는다.

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
BLOG_AUTOPUBLISH_MODE=draft_only
INNGEST_BLOG_AUTOPILOT_ENABLED=true
BLOG_GENERATION_CRON_ENABLED=false
BLOG_AUTO_ROLLBACK_ENABLED=true
BLOG_DAILY_AI_COST_CAP_USD=2
BLOG_REQUIRE_DEMAND_SIGNAL=true
BLOG_MAX_WEATHER_SHARE_30D=0.20
BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10=2
```

처음에는 반드시 `draft_only`다. migration과 canary 검증 후에만 `live`로 바꾼다. 일일 생성·공개 목표는 DB `publishing_policies.posts_per_day=5`만 사용한다. `INNGEST_EVENT_KEY`와 `INNGEST_SIGNING_KEY`는 공식 Vercel 통합으로 주입하며 둘 중 하나라도 없으면 생성 자체를 중지한다.

승격과 강등은 DB 원장에 일일 관측을 한 번만 기록해 자동 판단한다. 관측값 하나라도 없으면 healthy streak를 0으로 만들고 승격하지 않는다.

| 단계 | 최소 관찰 | 다음 단계 조건 |
|---|---:|---|
| pilot_3 | 완전한 healthy 관측 7일 + 해당 단계 발행 14건 | review/HIGH leak 0, 무승인 발행 0, cap/duplicate 위반 0, blog 5xx 임계 미만, 비용상한 준수, controller 99% 이상, indexing parity 100%, DB fallback 0.5% 이하, snapshot lag 5분 이하, GSC·analytics fresh |
| ramp_10 | 완전한 healthy 관측 7일 + 해당 단계 발행 50건 | 위 조건을 동일하게 유지하면 `max_30`으로 승격 |
| max_30 | 지속 | 30은 상한이지 목표가 아니다. 수요·근거·품질을 통과한 후보가 적으면 적게 발행 |

심각 사고(review/HIGH 공개, public leak, 승인 시도 없는 발행, cap/duplicate 위반, 15분 5xx 2건 이상, AI 비용 초과)는 즉시 `frozen`과 `pilot_3` 복귀다. 일반 불건전 관측이 2회 연속이면 한 단계 강등한다. 동결 해제는 원인 수정과 별도 승인 없이는 수행하지 않는다.

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

- DeepSeek 장애: 비용 reservation과 provider receipt 또는 오류 코드를 남긴다. 알 수 없는 비용은 예약액을 당일 종료까지 보유하고 다음 호출 예산에 포함한다. 다른 모델로 우회하지 않으며 낮 시간 controller는 기존 승인 초안만 공개한다.
- Naver HUB 장애: legacy Developers API로 fallback한다. 두 경로가 모두 실패해도 검증된 다른 demand가 있으면 진행하고, 없으면 발행하지 않는다.
- controller가 공개 commit 전에 실패하면 creative는 draft로 남고 run을 격리한다. 공개 commit 뒤 bookkeeping만 실패하면 공개 글을 격리하지 않고 `published_state_sync_error`로 표시해 원장 동기화를 복구한다.
- 자동 대표 갱신 실패 시 `blog_information_automated_replacements`와 indexing job이 없고 기존 canonical fingerprint가 그대로인지 확인한다. 성공 시 canonical creative ID/slug/원래 `published_at` 불변, shadow draft archived, 원장 1건, outbox 1건을 함께 확인한다.
- 앱 롤백: 먼저 cron을 기존 publisher 경로로 되돌리고 `BLOG_AUTOPUBLISH_MODE=draft_only`로 전환한다.
- DB 롤백: 앱 롤백 후에만 migration 하단의 수동 rollback SQL을 실행한다. 원장은 삭제되므로 export와 승인 필요하다.
