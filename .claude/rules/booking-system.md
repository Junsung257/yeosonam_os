---
description: 예약 상태 머신 (ALLOWED_TRANSITIONS) + 입금 매칭 임계값. 상태 전이는 booking-state-machine.ts 통과 강제.
paths:
  - "src/lib/booking-state-machine.ts"
  - "src/lib/payment-matcher.ts"
  - "src/app/api/bookings/**/*.ts"
  - "src/app/api/payments/**/*.ts"
  - "src/app/admin/bookings/**/*.tsx"
  - "src/app/admin/payments/**/*.tsx"
---

# 도메인 레시피: 예약 시스템

## 예약 상태 머신
상태 전이는 반드시 `booking-state-machine.ts`의 `ALLOWED_TRANSITIONS`를 통해서만 합니다:
```
pending → waiting_deposit → deposit_paid → waiting_balance → fully_paid
                                                              ↓
                                                          cancelled
```
모든 전이 시 `message_logs` 테이블에 이벤트 기록:
`DEPOSIT_NOTICE`, `DEPOSIT_CONFIRMED`, `BALANCE_NOTICE`, `BALANCE_CONFIRMED`, `CANCELLATION`

## 입금 매칭
`payment-matcher.ts`의 `matchPaymentToBookings()`를 사용:
- `AUTO_THRESHOLD = 0.90` → 자동 매칭
- `REVIEW_THRESHOLD = 0.60` → 수동 확인
- 신한은행 SMS 파싱만 지원 (타 은행 오파싱 위험)

## 정산 (settlement) — 사장님 ☑로만
**출금 자동매칭 절대 금지** — settlement는 사장님 승인 클릭으로만 처리. 입금만 자동 + 학습 (feedback memory `project_payment_command_matching` 참조).
