# 상품등록 V4/V5 운영·고객 공개 실시간 점검

점검일: 2026-08-10 (KST)  
점검 범위: Chrome 인증 세션, 여소남 운영 관리자, Vercel 운영 프로젝트, Supabase production, 고객 `/packages`·`/lp`

## 결론

기존 V3 호환 공개 경로는 공개 상품 표본에서 정상 동작한다. 그러나 V5 신규 등록 엔진의 운영 end-to-end는 아직 시작되지 않았다. V5 revision/proof/outbox가 production에 0건이며, 현재 Vercel production deployment는 상품등록 V5 작업 브랜치가 아닌 `affiliate-critical-remediation` 브랜치다. 따라서 전 상품 자동 공개 또는 V5 authoritative 전환은 보류한다.

## Chrome 실시간 확인

### 관리자

- `/admin/upload`: HWP/HWPX/PDF/JPG/PNG 업로드 UI가 존재하며 파일 최대 50개·파일당 10MB, 큐 우선 처리, 랜드사·수수료 내부 메타 입력을 안내한다.
- `/admin/packages?status=pending`: 상품 검수 대기 496건.
- 관광지 매칭 대기 34건, 관리자 알림 200건.
- 대기 상품 표본은 `검토 대기 / 감사차단 / 누락 1`, BICT 0/4 상태가 반복된다. 검수 없이 고객 공개하면 안 된다.
- production 집계상 customer-open 후보는 1건뿐이며, 나머지는 `blocked`, `draft`, `needs_review` 중 하나다.

### Vercel

- 프로젝트: `os`
- 고객 도메인: `www.yeosonam.com`
- production 상태: Ready
- 최신 production source: `affiliate-critical-remediation`, commit `e3f3048` (`docs(affiliate): record synthetic e2e verification`)
- 상품등록 V4/V5 작업 브랜치가 production에 배포된 증거는 확인되지 않았다.
- 환경변수 화면에서 `CRON_SECRET`, Supabase secret/publishable 계열 등은 존재한다. V5 shadow/authoritative 플래그는 목록에서 확인되지 않았고, 코드 기본값은 비활성이다. 값 자체는 열람하지 않았다.

### Supabase

- project `ixaxnvbmhzjvupissmly`, 상태 Healthy, 리전 Seoul.
- V5 migration·RLS·CAS RPC·FK 인덱스는 production에 반영되어 있다.
- `travel_packages`: 988건.
- `public_package_snapshots`: 4건.
- `product_registration_v5_revisions`: 0건.
- `product_registration_v5_proof_runs`: 0건.
- `product_registration_v5_publication_outbox`: 0건.
- V5 관련 security advisor findings: 0건. 별도 affiliate/settlement 영역의 기존 advisor 경고는 이번 상품등록 범위에서 수정하지 않았다.

## 고객 공개 표본

공개된 표본 `fd7e3032-817c-4912-bc78-13563005d2db`에 대해 다음을 실제 브라우저에서 확인했다.

- `/packages`: 목록에 1건 노출.
- `/packages/{id}`: 제목, 최저가 899,000원~, 출발일, 항공편, 포함·불포함, 5일 일정, 예약 문의 CTA 노출.
- `/lp/{id}`: 가격표, 4개 출발 가능일, 항공 일정, 5일 전체 일정, 포함·불포함, 상담 CTA 노출.
- 파트너 추천 코드 표시가 동작한다.
- snapshot에는 supplier raw/원가/내부 메모가 고객 문구에 노출되지 않는다.
- 해당 표본은 legacy public snapshot이며 `canonical_revision_id`가 null이다. 즉 고객 화면이 정상이라는 사실이 V5 canonical 승격을 증명하지는 않는다.

## 로컬 검증

- HWP 샘플 40/40 성공, 129 pages, 229 tables, 172,737 chars.
- 전체 Vitest: 665 files, 5,068 tests passed. V4/V5·price 관련 targeted tests 25 files, 167 tests passed.
- TypeScript type-check passed.
- ESLint passed with `--max-warnings=0`.
- `npm run build`는 5분 제한 안에 Next type-checking 단계를 끝내지 못해 완료 판정을 보류했다. 독립 TypeScript 검사와 전체 테스트는 통과했으며, 이는 별도 빌드 시간/환경 과제로 남긴다.
- Product registration contract check passed.
- Migration prefix audit: historical collisions 16, new collisions 0.
- V5 strict verifier는 local Supabase admin env가 없어 `SUPABASE_ADMIN_UNAVAILABLE`로 실패했다. Remote production schema/count는 MCP read-only query로 별도 확인했다.

## 2026-08-10 최신 샘플 재검증

- HWP 40/40 extraction·normalization 성공, 66 sections, evidence coverage 100%, render contract 66/66.
- customer-open 후보 4/66, needs review 44/66, blocked 18/66. 판정은 `limited_manual_pilot`이며 샘플 전체 자동 공개는 차단된다.
- V5 offline shadow artifact는 `data/product-registration/v5-shadow-corpus/2026-08-10.json`과 같은 이름의 audit report로 갱신했다. 오프라인 runner는 운영 attractions SSOT를 주입하지 않으므로 attraction unmatched 수치는 보수적 상한이다.
- C12 가격 원문 대조는 만료 상품도 비교하고, C14 freshness가 별도로 만료를 차단한다. 따라서 가격 불일치가 `skip`으로 숨겨지지 않는다.

## 남은 공개 차단요소

1. 샘플 원문 1건을 V5 shadow로 실제 upload → extraction → normalization → revision까지 넣고 결과를 확인해야 한다.
2. 같은 revision에서 public snapshot → browser proof → CAS pointer → outbox → cache convergence를 운영 표본으로 검증해야 한다.
3. V3/V4 critical field diff가 0인지 확인해야 한다.
4. V5 작업 브랜치 preview 배포 후 모바일 proof를 통과시키고, production 배포는 별도 승인 후 진행해야 한다.
5. 496건의 기존 검수 대기 상품은 일괄 승인 대상이 아니라 누락·감사차단 원인별 repair/review 큐로 처리해야 한다.

## 점검 중 수행하지 않은 작업

원문 업로드, 큐 추가, 상품 승인, V5 flag 활성화, Vercel production deploy, Supabase 데이터 변경은 수행하지 않았다. 모두 외부 상태를 변경하거나 고객 노출에 직접 영향을 주는 작업이므로, shadow/canary 범위와 대상 상품을 정한 뒤 실행한다.
