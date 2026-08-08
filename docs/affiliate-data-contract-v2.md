# Affiliate Data Contract V2

## 상태 경계

`affiliate_applications`: `PENDING → NEEDS_INFO → APPROVED/REJECTED/WITHDRAWN/EXPIRED`
`affiliate_sessions`: 발급 → 사용 → 만료/로그아웃/정지/토큰 회전 폐기
`affiliate_publications`: `DRAFT → TESTED → PUBLISHED → PAUSED/RETIRED`
`settlement_runs`: `HOLD → READY → PAYOUT_PENDING → COMPLETED`

완료된 정산과 지급 증빙은 UPDATE/DELETE하지 않는다. 정정은 새 `commission_ledger_entries(REVERSAL|ADJUSTMENT)`와 `settlement_revisions`로만 연결한다.

## 안정적인 식별자 체인

```text
affiliate_id
  + publication_id
  + touchpoint.event_id
  + attribution_decision_id
  + booking_id
  + commission_ledger_entries.id
  + settlement_lines.id
  + settlement_runs.id
  + payouts.id
```

## 금액 규칙

- 저장 금액은 KRW integer/bigint이다.
- 커미션 정책은 예약 시점 `policy_set_version`, `calculation_trace_id`, 적용률, 기준금액을 snapshot한다.
- 정책 조회·상한 조회·trigger 해석 오류는 커미션 확정이 아니라 `CALCULATION_HOLD`다.
- creator code는 가격을 바꾸지 않는다.
- discount campaign만 quote/payment/receipt/refund/ledger에 할인 금액을 전달한다.
- 이월 scalar는 다음 달로 전달하지 않는다. 미정산 ledger 잔액만 다음 run에 포함한다.

## 정책 담당자 승인 필요 항목

1. 최소 지급액의 기준: 당월 발생액 또는 누적 미지급액
2. 최소 예약 건수의 기간
3. 조정액의 지급 자격 포함 여부
4. 개인 원천징수와 사업자 세금 증빙 처리
5. 정산 가능 시점: 결제 완료/여행 완료/귀국일
6. 부분 환불 커미션 차감 방식
7. 지급 후 취소 회수 방식
8. 지급일과 휴일 처리
9. 이의제기 접수 마감
10. HOLD SLA
11. 계좌 변경 잠금 기간
12. 파트너 종료 후 미지급금 지급 기간

정책 버전이 활성화되기 전에는 자동 정산을 실행하지 않는다.
