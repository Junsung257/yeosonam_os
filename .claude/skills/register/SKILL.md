---
name: register
description: 통합 상품등록 Kernel workflow를 시작하고 자동 공개·안전 축약 공개·안전 차단 중 하나의 종결 결과를 보고한다. 사용자 명시 호출만 허용한다.
argument-hint: [원문 또는 파일] [랜드사명 선택] [커미션 선택, 기본 9%]
model: claude-sonnet-4-6
disable-model-invocation: true
---

# 통합 상품등록 — Kernel 전용 진입점

사용자 입력:

$ARGUMENTS

이 명령은 상품 행을 직접 INSERT/UPDATE하거나 기존 상품을 즉시 활성화하는 명령이 아니다. 원문을 보존하고 `POST /api/upload`를 통해 단일 V6 workflow를 시작하는 운영 진입점이다.

## 절대 규칙

- 원문은 private source document로 바이트 그대로 보존하고 SHA-256을 기록한다.
- `products`, `travel_packages`, revision, snapshot을 직접 수정하지 않는다.
- 신규 상품 사실은 `commit_revision_atomic`을 통해서만 저장한다.
- 고객 공개는 동일 revision/snapshot/proof hash를 확인하는 `publish_snapshot_atomic`을 통해서만 수행한다.
- repair, reextract, 문구·사진·가격 수정은 기존 행 수정이 아니라 correction revision을 만든다.
- proof를 위해 상품을 임시 `active`로 변경하지 않는다.
- publication freeze와 상품·랜드사·parser·profile kill switch를 우회하지 않는다.
- 관광지·호텔·골프장 master를 원문이나 AI만으로 자동 생성하지 않는다. 매칭 실패는 review queue에 남긴다.
- AI는 상품 경계·표 관계·고객 표현의 후보만 제안한다. 가격·날짜·호텔·항공편의 증거가 될 수 없다.

## 실행 순서

1. 입력 파일 또는 붙여넣기 원문, 랜드사명, 커미션을 확인한다. 커미션이 없으면 9%를 사용한다.
2. `/api/upload`에 원문을 한 번만 전달한다. API가 반환한 실제 `sourceDocumentId`, `jobId`, `workflowRunId`만 추적한다.
3. workflow가 다음 단계를 수행하도록 둔다.
   - intake → preflight → deduplicate → extract → bundle_sources
   - segment → normalize → shared facts → validate → copy/media
   - immutable snapshot → signed mobile proof → CAS publication → surface convergence
4. `GET /api/admin/product-registration/jobs/{jobId}`로 terminal state까지 확인한다.
5. 결과는 반드시 다음 셋 중 하나여야 한다.
   - `published_verified`: 핵심 사실과 proof가 모두 확인되어 공개됨
   - `published_degraded`: 불확실한 비핵심 값만 숨기거나 상담 확인으로 표시하여 공개됨
   - `blocked_action_required`: 가격·출발일·통화·상품 경계 같은 핵심 판매 사실이 모호하여 비노출
6. terminal state가 없으면 성공으로 보고하지 않는다. retry/dead-letter/차단 사유를 확인한다.

## 확정 업무 정책

- `899,`, `399 특가`, `839.000`은 각각 899,000원, 399,000원, 839,000원으로 정규화한다.
- `839,000 → 599,000`은 정상가 839,000원·판매가 599,000원으로 저장한다.
- 특정 날짜 가격은 기본가를 override한다. 가격 없는 제외일자는 판매가 미정으로 비노출한다.
- 발권기한은 출발 가격을 없애지 않고 예약 조건으로 표시한다.
- 고객 예상예산은 판매가 + 유류할증료다. 가이드비·현지비·선택관광은 자동 합산하지 않는다.
- 가이드비 불포함은 불포함 항목에만 표시한다.
- 취소조건이 없으면 승인된 표준약관 revision을 적용한다.
- 아동가·싱글차지가 없으면 상담 확인으로 표시한다.
- 연도 없는 출발일은 업로드 기준 이미 지난 월이면 다음 해, 지나지 않았으면 올해로 해석하며 과거 출발은 저장하지 않는다.
- 진짜 판매가가 없는 원문은 등록하지 않고 `discarded_source_incomplete`와 관리자 알림으로 종결한다.

## 고객 보고 형식

기술 로그 대신 아래 내용을 짧게 보고한다.

- 발견 상품 수와 상품 구분 축(호텔·기간·등급)
- terminal state별 상품 수
- 공개된 고객 URL과 snapshot hash
- verified/degraded의 차이와 숨긴 값
- blocked 상품의 원문 위치, 차단 이유, 해결 조건
- 가격·출발일·통화·약관·모바일 proof 통과 여부

독립 이중검수 benchmark가 고객 오픈 기준을 통과하지 않았거나 publication freeze가 켜져 있으면, 고객 공개 완료라고 표현하지 않는다.
