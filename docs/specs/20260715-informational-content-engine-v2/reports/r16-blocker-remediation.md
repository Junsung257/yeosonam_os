# R16 Blocker Remediation Verification

- 최종 판정: **READY FOR INDEPENDENT R16 REAUDIT**
- 시작 HEAD: `07f2c86d340212c255a0a38cf46ad5ba4d4860b8`
- 검증 구현 HEAD: `fd29fce626a75e27baaccb6231db536ee30ef69e`
- 브랜치: `codex/informational-content-engine-v2-r16-fixes`
- 작업 폴더: `C:\dev\yeosonam-os-info-v2-r16-fixes`
- 원격 Supabase 접근·변경: **0건**
- push / PR / 배포: **0건**
- 검증일: 2026-07-17 KST

> 이 문서 커밋은 검증 구현 HEAD 다음에 추가되는 보고서 전용 커밋이다. R17 진행, 원격 migration, push, PR, 배포를 승인하지 않는다.

## 1. 최종 판정

R16에서 확정된 blocker를 모두 로컬 전용 forward-only 변경으로 교정했다. 빈 로컬 DB 전체 migration 재생 2회, 전체 pgTAP, 실제 다중 DB 세션 동시성, 전체 애플리케이션 회귀, 형검사, 린트, production build가 통과했다.

**READY FOR INDEPENDENT R16 REAUDIT**이며, 이는 R17 자동 진행 또는 원격 반영 승인이 아니다.

## 2. Finding 폐쇄표

| Finding | 교정 전 재현 | 교정 | 최종 증거 | 상태 |
| --- | --- | --- | --- | --- |
| F1 claim fail-open | adversarial 9문장 중 7문장이 사실 claim 없이 통과 | 문장 분류를 `verified_factual / subjective_editorial / navigation_boilerplate / unknown_unclassified`로 고정하고 unknown을 fail-closed | 필수 adversarial 9/9 차단, 정상 corpus 통과, 정보성 집중 275/275 | CLOSED |
| F2 official source self-attestation | caller가 넣은 official 메타데이터와 악성 host가 신뢰됨 | 검수된 official-source registry의 exact host/source type만 신뢰 | suffix/evil host 차단, 검수된 exact host만 허용 | CLOSED |
| F3 evidence self-attestation | 임의 hash/excerpt, 미래 시각, 느슨한 `US` scope가 통과 | 정규화 snapshot의 SHA-256, Unicode exact span, 시간·scope 결속 | fabricated hash/span/future/scope 재사용 차단 | CLOSED |
| F4 ledger idempotency | exact retry가 이중 반영되고 key 충돌·clamp·rollback 계약이 깨짐 | 전역 request claim을 balance 변경 전에 획득하고 적용 delta와 결과를 영속화 | pgTAP 13/13, 실제 동일 key·다른 key 두 세션 통과 | CLOSED |
| F5 Band product identity | `products.id`를 가정한 UUID FK, audit 실패 은닉 가능 | 실제 PK `products.internal_code`에 명시 FK, product+audit 단일 RPC | pgTAP 9/9, helper 2/2, 오류 전파·원자 rollback 통과 | CLOSED |
| F6 migration safety | 일부 변경 파일만 검사하고 HIGH/CRITICAL에도 exit 0 | base..head A/M/D/R 전체 검사, checksum/semantic/FK index/exit fail-closed | 최종 신규 migration 6개 0 issue, 음성 fixture 119 issue·exit 1 | CLOSED |
| F7 Vercel ignore-build | 마지막 커밋만 보고 code 포함 범위를 skip | previous SHA/base와 head의 merge-base 전체 범위 검사, shallow/unknown fail-closed | code 포함 81개 build, docs 5개 skip, unknown base build | CLOSED |
| F8 privileged write RPC | 4개 SECURITY DEFINER 쓰기 RPC가 PUBLIC 기본 EXECUTE | PUBLIC/anon/authenticated revoke, service_role만 grant | 교정 전 8/12 실패, 교정 후 pgTAP 12/12 및 실제 역할 차단 | CLOSED |

## 3. 커밋 목록

1. `17d57170` — `fix(blog): fail closed on unclassified factual statements`
2. `08b2a7ba` — `fix(blog): derive official trust from reviewed registry`
3. `79154970` — `fix(blog): bind evidence to immutable source snapshots`
4. `b3ba02e6` — `fix(ledger): claim idempotency before balance mutation`
5. `08afb063` — `fix(band): persist product audit identity atomically`
6. `dca6b941` — `fix(ci): enforce full-range migration safety gate`
7. `fbaf61ad` — `fix(vercel): inspect complete deployment diff range`
8. `70508209` — `fix(db): restrict legacy privileged rpc execution`
9. `a28e257a` — `test(blog): align legacy audit with fail-closed claims`
10. `8a8d1bd9` — `test(ci): allow integration checks under full-suite load`
11. `bb4e947d` — `fix(band): narrow validated import price`
12. `4842070c` — `test(vercel): provide typed deployment environment`
13. `fd29fce6` — `test(ci): allow migration range checks under full-suite load`

검증 구현 변경 범위는 39개 파일, `+1,863 / -537`이며 이 보고서까지 포함한 최종 브랜치 범위는 40개 파일이다. 기존 historical migration의 추가 renumber, 삭제, rename, squash는 없었다.

## 4. 신규 forward migration

1. `20260716220346_blog_information_official_source_registry.sql`
2. `20260716221727_blog_information_source_snapshots.sql`
3. `20260716222255_booking_ledger_idempotency.sql`
4. `20260716222715_band_import_product_identity.sql`
5. `20260717010606_band_import_product_identity_index.sql`
6. `20260717031947_restrict_legacy_privileged_rpc_execute.sql`

## 5. Claim·source trust·evidence 결과

- 미분류 assertive 문장은 `unknown_unclassified` 사실 후보로 ledger에 들어가며 persisted evidence가 없으면 발행할 수 없다.
- 정상 편집·내비게이션 문장은 명시 분류되고, 기존 글 감사의 `KEEP` fixture도 validated fingerprint가 있을 때만 유지된다. 동일 글에서 fingerprint를 제거하면 `REWRITE / unsupported_claims`가 된다.
- official 여부는 caller 메타데이터가 아니라 검수 registry의 활성 row, exact hostname, source type 일치로 결정된다.
- snapshot 원문과 정규화 본문을 영속화하고 서버가 SHA-256을 계산한다. caller 제공 hash로 우회할 수 없다.
- excerpt는 snapshot의 exact Unicode span이어야 한다. snapshot에 없는 문장, 미래 `retrievedAt`, 다른 destination/nationality/locale/currency/date scope, `US`가 `Australia`에 부분 일치하는 경우를 차단했다.
- 정보성 집중 회귀: **29 files / 275 tests PASS**.
- `npm run eval:blog-info-v2`: **10/10 PASS**, 외부 API 0, 공개·운영 mutation 0.

## 6. Ledger·Band 결과

### Ledger

- pgTAP: **13/13 PASS**.
- exact retry: booking `paid_amount=100`, ledger 1건, claim 1건.
- 같은 key + 다른 booking/delta: 명시적 conflict, 대상 booking 무변경.
- 실제 동일 key 두 세션: 두 호출 exit 0, 최종 `paid_amount=100`, ledger 1건, claim 1건.
- 실제 다른 key·같은 booking 두 세션: 두 호출 exit 0, 최종 `paid_amount=200`, ledger 합계 200, ledger 2건, claim 2건.
- 음수 clamp는 요청 delta가 아니라 실제 적용 delta를 ledger에 기록하며 booking balance와 합계가 일치한다.
- booking/ledger/정산/Band 집중 회귀: **9 files / 154 tests PASS**.

### Band

- `band_import_log.product_internal_code`는 `products(internal_code)`를 참조한다.
- legacy `product_id uuid`는 `travel_packages(id)` 의미를 유지해 두 product identity를 혼합하지 않는다.
- `import_band_product_atomically`가 product와 audit row를 같은 트랜잭션에서 만든다.
- save API와 cron은 RPC 오류를 성공으로 숨기지 않고, 성공 뒤에만 imported count를 증가시킨다.
- pgTAP: **9/9 PASS**. helper: **2/2 PASS**.

## 7. Migration-safety 결과

- 테스트: A/M/D/R, semantic/checksum 변경, FK index, HIGH/CRITICAL exit 계약 **4/4 PASS**.
- `07f2c86d..HEAD` 전체 범위: 신규 migration **6 files / 0 issue / exit 0**.
- 기존 foundational 음성 fixture: **119 HIGH/CRITICAL issues / checker exit 1**.
- workflow는 checker step 자체가 비정상 종료되며, 보고서 생성은 `always()`로 분리돼 실패를 성공으로 바꾸지 않는다.

## 8. Vercel Preview 결정 결과

- code 변경이 앞선 커밋에 있고 마지막 커밋이 docs인 실제 다중 커밋 범위: **81 significant files, exit 1, build**.
- docs-only 전체 범위: **5 files, exit 0, skip**.
- unknown/shallow base: **exit 1, build fail-closed**.
- delete 및 rename 양쪽 경로를 검사한다.
- 집중 테스트: **5/5 PASS**. 느린 임시 Git 통합 테스트는 Windows 전체 병렬 부하에서도 assertion을 끝까지 수행하도록 테스트별 20초 한도를 명시했다.

## 9. 조건부 RLS·Data API 후보 결과

실제 `anon`, `authenticated`, `service_role`, `postgres` 역할과 catalog의 RLS/force, policy qual/with-check, relation ACL, function ACL, view options를 확인했다. 노출이 재현되지 않은 후보는 변경하지 않았다.

| 후보 | Catalog 상태 | 실제 역할 probe | 판정·조치 |
| --- | --- | --- | --- |
| Toss secret·청구정보 | `billing_settings`, `billing_invoices`, `billing_history`, `tenant_subscriptions` RLS enabled, force false. 일부 authenticated SELECT policy가 있으나 anon/auth/service에 SELECT grant 없음 | anon/auth/service SELECT 모두 permission denied, postgres owner만 접근 | **NOT CONFIRMED** — 변경 없음 |
| social token | `tenant_oauth_tokens`와 `social_platform_configs` RLS enabled, `tenant_api_tokens` RLS disabled. 세 테이블 모두 anon/auth/service SELECT/DML grant 없음 | anon/auth/service token SELECT permission denied | **NOT CONFIRMED** — 변경 없음 |
| `anomaly_commission_alerts` | view는 `security_invoker`/`security_barrier` option 없음. anon/auth/service SELECT grant 없음 | 세 역할 모두 view SELECT permission denied | **NOT CONFIRMED** — exposure가 없어 view 변경 없음 |
| write SECURITY DEFINER RPC | `cleanup_expired_trend_posts`, `expire_mileage_batch`, `extend_mileage_expiry`, `increment_ab_metric`에 PUBLIC 기본 EXECUTE 재현 | 교정 후 anon/auth permission denied, service_role execute 허용 | **CONFIRMED → FIXED** |
| foundational baseline public tables 11개 | `tenants`, `land_operators`, `departing_locations`, `admin_users`, `group_rfqs`, `rfq_bids`, `rfq_messages`, `vouchers`, `booking_passengers`, `products`, `document_hashes`는 RLS/force false지만 anon/auth/service DML grant 없음 | anon/auth/service SELECT 차단, authenticated INSERT/UPDATE/DELETE 차단, postgres owner 접근 | **NOT CONFIRMED** — 변경 없음 |

정보성 내부 테이블 11개의 별도 RLS role matrix는 pgTAP으로 통과했다. anon/auth는 내부 읽기·쓰기와 발행/검수/CTA RPC가 차단되고 service_role 운영 경로는 허용된다.

## 10. 로컬 migration 재현 결과

- Docker Client/Server: 로컬 전용 프로젝트 `yeosonam-os` 컨테이너·네트워크·볼륨만 사용.
- 원격 관련 환경 변수는 모든 Supabase 명령 전에 제거.
- 최초 빈 volume start에서 380개 migration 적용 후 CLI 2.109.1의 catalog 읽기가 짧은 120초 wrapper를 초과했다. 해당 CLI 프로세스와 프로젝트 helper만 정리했고 DB 적용 결과는 380건이었다.
- 충분한 제한 시간의 `npx supabase start ... --ignore-health-check`: **exit 0**.
- `npx supabase db reset --local --no-seed` 1회차: **exit 0**.
- 동일 reset 2회차: **exit 0**.
- migration files: **380**.
- `supabase_migrations.schema_migrations`: **380 rows**.
- duplicate version groups: **0**.
- historical migration 추가 renumber: **0**.

## 11. pgTAP·실제 DB 세션 결과

| 파일 | 결과 |
| --- | ---: |
| `band_import_atomicity.sql` | PASS |
| `blog_information_atomic_runtime.sql` | PASS |
| `blog_information_failure_rollback.sql` | PASS |
| `blog_information_publication_contract.sql` | PASS |
| `blog_information_rls_matrix.sql` | PASS |
| `booking_ledger_idempotency.sql` | PASS |
| `r16_privileged_rpc_execute.sql` | PASS |
| 합계 | **7 files / 111 tests PASS / 0 fail / 0 skip** |

- 대표 발행 실제 두 세션: 한 요청 `idempotent=false`, 다른 요청 `idempotent=true`; publication 1, indexing job 1, active representative 1, deadlock 0.
- 실패 주입·rollback: 중간 publication과 고아 outbox 없음.
- DB lint: exit 0, error 0. 기존 PL/pgSQL 미사용·shadow warning 14건은 비차단 legacy warning이다.

## 12. 애플리케이션 전체 회귀 결과

| 검사 | 최종 결과 |
| --- | --- |
| 정보성 claim/evidence·인증·공개 eligibility·JSON-LD 집중 | 29 files / 275 tests PASS |
| booking·ledger·정산·Band 집중 | 9 files / 154 tests PASS |
| 상품 parser/snapshot/publication/detail/landing 경계 집중 | 15 files / 127 tests PASS |
| migration-safety + Vercel 집중 | 9 tests PASS |
| `npm run eval:blog-info-v2` | 10/10 PASS |
| `npm test` | **515 files / 3,647 tests PASS** |
| `npm run type-check` | PASS, 8 GB heap |
| `npm run lint` | PASS, warning 0 |
| `npm run build` | PASS, 390/390 static pages, postbuild verified, 8 GB heap |
| `git diff --check` | PASS |
| `.only` / `.skip` / `todo` marker 검색 | 0 |
| snapshot 자동 갱신 | 0 |

전체 병렬 부하에서 실제 파일 전수 탐색과 임시 Git 저장소 통합 테스트가 기본 5초를 넘는 경우가 있어 해당 느린 테스트 3종에만 20초 한도를 명시했다. assertion, 실패 exit, 음성 fixture를 제거하거나 오류를 swallow하지 않았다.

## 13. 상품성 경계 결과

- 일반 상품 등록 parser, snapshot schema, package publication writer, 상품 상세 페이지, 상품 landing page runtime은 변경하지 않았다.
- R16에서 허용된 상품 변경은 Band 전용 product+audit 원자 writer와 호출 경로뿐이다.
- 상품 경계 집중 회귀 **15 files / 127 tests PASS**.
- 기존 `auto_heal + product_id` 상품을 정보성 콘텐츠로 변환하거나 대표 registry에 자동 편입하지 않는다.
- 관광지 seed, 자동 matching, attraction DB mutation은 실행하지 않았다.

## 14. 남은 심각도

- CRITICAL: **0**
- HIGH: **0**
- MEDIUM: **0**
- LOW: **0**

위 수치는 검증된 R16 blocker/finding 기준이다. 노출이 재현되지 않은 조건부 후보는 finding으로 승격하거나 근거 없이 수정하지 않았다. DB lint legacy warning 14건은 별도 비차단 정적 경고다.

## 15. 원격·배포 경계

- 원격 Supabase read/write: **0**
- `.env.prod` 사용: **0**
- `--linked`, `db push`, migration repair: **0**
- push: **0**
- PR 생성·수정: **0**
- Vercel deploy: **0**
- staging / production mutation: **0**

## 16. 절대 실행하면 안 되는 다음 명령

독립 R16 재감사와 별도 승인 전에는 다음을 실행하지 않는다.

- `npx supabase link ...`
- `npx supabase db push`
- `npx supabase migration repair ...`
- `npx supabase db reset --linked`
- `.env.prod` 또는 staging/production DB URL을 사용한 migration/검증
- `git push`
- `gh pr create` 또는 PR mutation
- `vercel deploy`, `vercel --prod`
- historical migration rename/renumber/squash
- R17 구현·migration·배포 자동 진행

## 17. 최종 한 줄 결론

**READY FOR INDEPENDENT R16 REAUDIT — 로컬 blocker 교정과 검증은 완료됐으며, R17·push·PR·원격 migration·배포는 계속 금지한다.**
