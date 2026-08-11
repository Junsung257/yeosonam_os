# 상품등록 엔진 V4 근본 재설계 실행계획

Last updated: 2026-08-07

## Research decisions

- 기본 parser는 [rhwp v0.8.2 공식 릴리스](https://github.com/edwardkim/rhwp/releases/tag/v0.8.2)로 고정한다. Windows x64, Linux x64, macOS x64/arm64 자산과 checksum 파일이 있어 OS별 동일 동작을 만들 수 있다.
- [pyhwp](https://github.com/mete0r/pyhwp)는 AGPLv3 기반의 오래된 대안이므로 제품 런타임에 직접 포함하지 않는다. [hwp.js](https://github.com/hahnlee/hwp.js)는 브라우저 viewer 실험용으로만 참고하고 서버 등록 parser로 채택하지 않는다.
- HWPX는 ZIP/XML 컨테이너이므로 [한컴의 HWPX 안내](https://www.hancom.com/news/notice/detail/10924)와 rhwp 구조 추출 결과를 함께 검증한다. 압축 해제 후 임의 XML 파싱을 주 parser로 두지 않는다.
- 원문 파일은 [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)과 [Supabase API 보안 원칙](https://supabase.com/docs/guides/api/securing-your-api)에 맞춰 private bucket + service-role-only 정책으로 고정한다.

## 목표

랜드사 원문(HWP/HWPX/PDF/텍스트)을 업로드한 순간부터 고객이 보는 `/packages/{id}`와 `/lp/{id}`까지 같은 원문 증거와 같은 발행 스냅샷을 사용한다. 원문은 절대 덮어쓰지 않고, 추출·정규화·검수·고객 노출을 재시도 가능한 작업 상태로 관리한다.

## 현재 구현된 기반

1. `product_source_documents`: 원본 파일의 SHA-256, 크기, MIME, 원본 파일명, 비공개 Storage 경로를 보존한다. 동일 파일은 content-addressed dedupe한다.
2. `product_document_extractions`: `rhwp 0.8.2` 기반 구조 보존 DocumentIR과 parser 버전·checksum·추출 hash·품질 진단을 append-only로 저장한다.
3. `upload_jobs` V4 상태: `uploaded → preflight → extracted → segmented → normalized → verified → proofed → published`와 `needs_review/failed/quarantined`를 저장하며 시도 횟수·lease·오류·검수 사유를 남긴다.
4. `/admin/upload`: 기존 등록 호환성을 유지하면서 원문을 먼저 비공개 보관한 뒤 legacy 등록 어댑터를 호출한다.
5. HWP/HWPX: `rhwp`를 Node child process로 격리하고 텍스트·표·페이지·셀·row/col/span을 보존한다. 샘플 40개 전수 검증 결과는 40/40 성공, 129페이지, 229표다.
6. 고객 발행: 카드와 랜딩의 상품 ID·제목·목적지·가격·기간·대표 이미지가 다르면 publish gate에서 차단하고, 구형 스냅샷도 조회 시 동일 검사를 통과해야 한다.
7. 자동 실행: V4 큐를 claim하는 cron이 2분마다 최대 3건을 처리하며, 실패는 재시도 가능한 실패 상태와 오류 코드로 남긴다.

## 기준 아키텍처

```text
admin/upload
  → immutable source archive (private storage + sha256)
  → upload_jobs V4 lease
  → preflight/security metadata
  → rhwp DocumentIR (pages/paragraphs/tables/cells/evidence)
  → deterministic segmentation + source-backed normalization
  → standard registration schema + price/date/entity QA
  → public snapshot + /packages,/lp surface parity
  → real mobile browser proof
  → atomic publication or needs_review/quarantine
```

## 완료 기준

- 원문 파일과 추출 결과가 모든 등록 결과에서 역추적된다.
- 동일 원문 재업로드는 중복 저장하지 않고 기존 source/extraction을 재사용한다.
- parser 미설치, 추출 실패, OCR 필요, 비정상 MIME는 고객 노출 없이 `failed` 또는 `needs_review`로 끝난다.
- 가격·출발일·일정·관광지 ID·이미지·고객 문구는 source evidence가 없으면 자동 발행하지 않는다.
- `/packages`와 `/lp`는 같은 public snapshot hash와 핵심 identity 값을 사용한다.
- 발행은 publish gate, mobile proof, customer-open contract, atomic RPC를 모두 통과할 때만 가능하다.
- 모든 stage는 idempotent하며 cron 중복 실행에도 한 작업이 두 번 등록되지 않는다.

## 다음 구현 순서

### P0 — 현재 브랜치에서 마무리

- V4 추출 결과를 기존 `normalized_intakes`/`product_registration_drafts`와 연결하고, 최종 등록 payload에 source/extraction/job lineage를 강제한다. (완료)
- V4 cron이 `uploaded → extracted → segmented → normalized`를 호출하도록 연결한다. canonical snapshot은 `product_registration_v4_normalizations`에 append-only로 저장되고, 품질 실패는 `needs_review`/`failed`로 닫힌다. (완료)
- `/admin/upload`에 job 단계·오류·원문 lineage를 표시하고 bounded retry와 needs_review 조작을 제공한다. (완료)
- HWP 샘플 fixture를 CI에서 실행할 수 있도록 `rhwp` binary 설치/경로 정책을 확정한다. (완료)
- canonical completion is now a mandatory publish gate for V4-lineage packages: admin approval checks the job pointer and source/job/extraction lineage before the existing package/public-snapshot writer can publish. The writer remains the compatibility formatter until a future schema-level payload replacement is separately benchmarked.

### P1 — 고객 노출 품질

- 실제 `/packages`와 `/lp`의 렌더 payload를 공통 canonical customer payload로 투영한다.
- 모바일 브라우저 proof를 `proofed` 단계와 연결하고, snapshot hash mismatch를 자동 재생성 대상으로 만든다.
- 기존 직접 승인/상태 변경 경로를 canonical publication RPC로 수렴한다.

### P2 — 운영 확장

- HWPX/PDF 이미지·스캔 문서는 `PRODUCT_REGISTRATION_V4_OCR_ENABLED=1` 명시 시 기존 OCR 경계를 통해 동일 DocumentIR/evidence 계약으로 저장한다. 기본값은 disabled이며 provider·비용·golden-corpus 승인 전에는 `needs_review`로 닫는다. (구현 완료, 운영 활성화는 별도 승인)
- land operator별 layout profile은 규칙 후보로만 학습하고, fixture·회귀 테스트·검토 없이 production parser를 자동 변경하지 않는다.
- stage latency, parser error, review rate, proof failure, customer parity drift를 운영 KPI로 기록한다.

## 안전 원칙

- 원문 Storage bucket은 private이며 신규 source/extraction 테이블은 service role만 Data API에 접근한다.
- 관광지 매칭은 기존 matcher/alias/admin SSOT를 사용한다. 자동 관광지 INSERT는 금지한다.
- AI는 구조화된 제안과 검수 후보만 만들 수 있고, source evidence가 없는 가격·일정·호텔·관광지·보장 문구를 확정할 수 없다.
- 레거시 행은 V4로 조용히 재해석하지 않는다. 새 evidence-bound 제약은 V4 행에만 적용한다.

## 검증 명령

```text
npm run type-check
npm run check:product-registration-contract
npm run verify:product-registration-v4:hwp
npx vitest run src/lib/package-publication/customer-surface-parity.test.ts
```

## 2026-08-06 추가 하드닝

- 원문 저장 직후가 아니라 파서 직전에 SHA-256을 다시 대조한다. 불일치하거나 HWP/HWPX/PDF/이미지의 실제 매직 바이트가 맞지 않으면 원문과 작업을 격리한다.
- `DocumentIR`는 버전·원문 형식·페이지·노드·테이블·자산·parser 메타데이터를 저장 전에 검증한다.
- 구형 `/api/upload` 직접 호출도 private 원문 보관과 V4 job 생성 없이는 상품 부작용을 실행하지 않는다. 파이프라인 예외는 작업을 `failed`로 닫는다.
- 실패·검수대기 작업은 관리자 retry API에서 최대 5회까지 재처리할 수 있고, 격리/삭제 원문은 재업로드를 요구한다.
- 모바일 proof와 verify를 통과한 뒤 관리자 승인으로 public snapshot이 생성되면 V4 job을 `published/done`으로 동기화한다.

## 2026-08-07 V4 remaining work completed

- `product_registration_v4_normalizations` is the append-only canonical snapshot for one extraction, normalization version, and raw-text hash. It stores deterministic sections, the V3 customer payload, quality diagnostics, and the publish-gate result under the original source/job/extraction lineage.
- The V4 cron now claims extraction jobs first and then claims `extracted` jobs for deterministic segmentation and canonical normalization. A compatibility upload that has already reached a later stage cannot be rewound by a slower extraction worker; the worker only attaches the missing extraction lineage.
- Image OCR is implemented as an explicit profile, but remains fail-closed by default. Set `PRODUCT_REGISTRATION_V4_OCR_ENABLED=1` only after the OCR provider, cost ceiling, and golden-corpus review are approved. Disabled or low-confidence OCR becomes `needs_review` and never becomes customer-visible automatically.
- The canonical worker is intentionally pure and evidence-bound. It does not create attraction masters or bypass the existing matcher/admin SSOT. Package/public-snapshot cutover remains a compatibility rollout step: the canonical snapshot is ready and auditable, while the legacy registration writer remains the final persistence adapter until the rollout gate is enabled.
- The compatibility writer is now protected by the canonical gate itself, not only by the admin route. Customer readers and secondary public surfaces also verify V4 lineage before returning or rendering a snapshot. A proof job that finishes before canonical normalization remains `normalized/processing` and is claimable by the backfill worker.
