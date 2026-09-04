# Product Registration V6 Human Review Contract

## 목적

PR-V6-04는 원문 해석이 모호한 상품등록 건을 사람 검수로 끝내기 위한 내부 증거 계약이다. 검수 결과는 원본 추출본을 수정하지 않고 Receipt와 `review_completed` 이벤트로 추가 기록한다. 이 단계는 Revision, Snapshot, Publication Pointer, 고객 URL을 만들거나 변경하지 않는다.

## 상태

```text
queued → in_review → awaiting_second
                         ├─ accepted
                         ├─ source_insufficient
                         ├─ system_quarantined
                         └─ adjudication_required → (adjudicator) → terminal
```

두 검수자의 결정·정정 payload·evidence가 모두 같을 때만 자동으로 종결한다. 값이 같아도 상품축이 다르거나 evidence가 다르면 `adjudication_required`로 보낸다.

## 검수 패킷

`ReviewPacketV1`은 다음 계보를 고정한다.

- source document ID와 SHA-256
- parent extraction ID와 extraction hash
- 선택적 normalization ID
- field별 후보 상품축·후보값·차단 이유
- 셀 주소와 `cell_with_headers`/`page_region`/`full_page` 렌더 정책
- candidate axis set hash와 packet hash

패킷에는 원문 전체, 고객 개인정보, signed URL을 넣지 않는다. UI가 원문을 표시할 때는 이 ID를 사용해 별도 서버 경로에서 권한 검증 후 제공한다.

## Receipt

`ReviewReceiptV1`은 실제 Supabase 사용자 UUID와 일회성 검수 세션 UUID를 요구한다. API token, 공유 관리자 쿠키, 이름·이메일 문자열은 reviewer identity로 인정하지 않는다.

허용 결정:

- `accept_auto_candidate`
- `select_axis`
- `correct_value_with_evidence`
- `mark_source_insufficient`
- `mark_system_defect`
- `defer_need_more_context`

모든 결정은 최소 하나의 source evidence와 5자 이상의 이유를 가져야 한다. `select_axis`/`accept_auto_candidate`는 `selectedAxisKey`, 정정은 field별 `patches`와 source cell evidence를 추가로 요구한다. Receipt hash는 서버 계약의 canonical JSON으로 계산한 값이며, 재전송 시 같은 hash만 멱등적으로 재사용한다.
`createdAt`은 감사용 wall-clock metadata이며 Receipt business identity에서는 제외한다. DB가 저장 시 server timestamptz로 표현을 정규화해도 동일 Receipt hash를 재생할 수 있어야 한다.

## 독립성·조정

- first와 second는 같은 케이스에서 서로 다른 사용자여야 한다.
- adjudicator는 first/second와 다른 세 번째 사용자여야 한다.
- 검수자는 제출 전에 다른 검수자의 결과를 볼 수 없어야 한다. 대기열 RPC는 본인이 이미 Receipt를 남긴 케이스를 제외한다.
- 두 결과가 다르면 자동으로 상품을 고르지 않고 `adjudication_required`로 남긴다.

## 저장 경계

`internal_product_registration.product_review_cases`, `product_review_sessions`, `product_review_receipts`, `product_review_events`는 RLS 강제·클라이언트 권한 제거 상태이며 service-role RPC만 접근한다. Receipt와 이벤트는 update/delete가 금지된 append-only 원장이다. 케이스 상태 변경도 RPC 내부에서만 수행한다.

이벤트 payload는 케이스·Receipt ID, 검수 순서, 다음 상태만 포함한다. 원문, PII, provider 응답, signed URL은 이벤트에 복제하지 않는다.

## 다음 단계 연결

PR-V6-05에서 `/admin/product-registration/reviews` 3-pane 검수 UI와 lineage-bound case read RPC를 붙였다. UI는 원문 텍스트·복원 표·후보 상품축을 보여주고, 세션을 연 뒤 Receipt API만 제출한다. 브라우저는 Supabase를 직접 조회하지 않고 다른 검수자의 Receipt도 볼 수 없다. PR-V6-06의 review-resume worker는 terminal `review_completed` 이벤트만 lease로 claim하고, Receipt 집합을 다시 대조한다. 값 정정은 `human_review` 파생 추출본을 append-only로 만들고 재정규화하며, 상품축만 선택한 판정은 no-op child를 만들지 않고 parent 기반 shadow normalization으로 재검증한다. 원문 부족·시스템 격리는 파생본 없이 종결한다. 그 뒤에도 전체 validator와 mobile proof를 통과하기 전에는 공개 포인터를 변경하지 않는다.
