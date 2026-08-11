# 상품등록 엔진 V5 고객 공개 최종 검증

검증일: 2026-08-10 (KST)  
범위: 운영 Supabase, 실제 HWP 표본, `/packages`, `/lp`, OG/affiliate 수렴

## 최종 판정

샘플 상품 `41441e88-097e-4362-89c7-92be9653ce02`는 현재 고객 공개 가능 상태다. 고객이 보는 값은 V5 immutable revision에서 만든 public snapshot 하나를 기준으로 하며, publication pointer가 CAS로 그 snapshot만 가리킨다.

## 확인된 원장

- V4 source/job/extraction/normalization lineage: 일치, V4 gate `ok=true`
- V5 revision: `93ed6234-bc8f-41f4-b7ce-e8a54bd8caaa`, `approved`
- public snapshot: `5db423b8-e52a-49c9-bc10-0d315d202972`, `published`
- snapshot hash: `326a04557f4285502aebe234ab8c293871dce9ee5e8549eb0c204b7cb6f6fee0`
- publication pointer: `published`, version 6
- 가격 85개: 날짜·금액 형식 및 양수 검증 통과
- 이미지·제목·카드/LP parity·고객 문구 금칙어·route text: 모두 통과
- 관광지 SSOT 미매칭: 0건

## 고객 표면 검증

동일 snapshot hash에 대해 다음 4면이 모두 `converged`다.

1. `/packages/{id}`
2. `/lp/{id}`
3. OG
4. affiliate

헤더 없는 실제 고객 조건의 390×844 모바일 브라우저에서 `/packages`와 `/lp`를 각각 HTTP 200으로 확인했다. 두 화면 모두 snapshot marker와 동일 hash, 고객 CTA를 포함하며 404/상품 없음 화면이 아니다.

## 운영·재현성 검증

- V5 strict verifier: PASS (14개 테이블, 핵심 컬럼, CAS lineage guard)
- operational audit: `healthy=true`, blockers `[]`
- current convergence: 4/4 `converged`
- outbox: 전체 `delivered`, pending/failed/dead-letter 0건
- 전체 Vitest: 665 files / 5,072 tests passed
- TypeScript: passed
- ESLint: passed with `--max-warnings=0`
- production bundle: `npm run build` PASS (387 static pages, postbuild output verification PASS)

구버전 immutable snapshot의 `stale` 행은 삭제하지 않고 감사 이력으로 보존한다. 운영 건강성은 현재 publication pointer가 가리키는 snapshot의 수렴 상태만 평가하므로, 과거 이력이 정상 공개 상품을 잘못 차단하지 않는다.

## 적용 기준

이 샘플은 고객에게 노출해도 된다. 이후 상품은 업로드→원문 hash→추출→정규화→V5 revision→proof→CAS publication→outbox→surface convergence의 동일 순서를 통과해야 하며, 어느 단계라도 누락되면 고객 표면을 닫는다.
