# Settlement and Ledger Errors

Last updated: 2026-06-07

정산, ledger, 입금, 은행/SMS 매칭, 세무, 지급 흐름 반복 오류 상세.

## ERR-LEDGER-drift@2026-04-30

> Original source before 2026-06-07 split: `db/error-registry.md:1002`

- [ ] **ERR-LEDGER-drift@2026-04-30** (재무 정합성 — Phase 2a 이중쓰기 drift 발생 시 응급 절차): `bookings.paid_amount / total_paid_out` 와 `SUM(ledger_entries.amount)` 가 일치해야 함 (Phase 2a 이중쓰기 보장). 일치하지 않으면 = ledger 우회 경로가 있다는 뜻 → 모든 매칭·환불·정산 신뢰도 붕괴. **검출**: ① 매일 03:30 UTC `/api/cron/ledger-reconcile` cron — drift > 0 발견 시 어드민 푸시 + Slack alert (SLACK_ALERT_WEBHOOK_URL) 동시 발송. ② `/admin/payments` 헤더 `LedgerStatusChip` (60s 폴링) 빨간 펄스 표시. ③ `/admin/payments/reconcile` 페이지에서 booking 단위 drift 즉시 조회. **응급 절차**: ① `/admin/payments/reconcile` 진입 → drift sample 20건 확인 → 어떤 source 누락 인지 BookingDrawer "📒 원장 보기" 로 ledger 시간순 비교. ② drift 원인이 ledger 우회 코드 경로(직접 UPDATE bookings.paid_amount 발견)면 **즉시 push 차단** + 핫픽스. ③ 영향 booking 들에 대해 `record_manual_paid_amount_change` RPC 로 ledger entry 보정 (memo 에 ERR-LEDGER-drift 인시던트 ID 명시). ④ 또는 어드민 "입금 재동기화" (resync_paid_amounts_with_ledger RPC) 로 일괄 보정 entry 자동 생성. **재발 방지**: ① bookings.paid_amount / total_paid_out 직접 UPDATE 코드를 추가하면 안 됨 — 모든 변경은 RPC (update_booking_ledger / record_manual_paid_amount_change / confirm_payment_match / create_land_settlement / reverse_land_settlement / resync_paid_amounts_with_ledger) 경유. ② 새 매칭/정산 경로 추가 시 idempotency_key 컨벤션 준수 (`<source>:<external_id>` 패턴). ③ ledger_entries 는 RLS service_role-only — 클라이언트 코드에서 anon key 로 조회 불가. ④ Phase 2b (읽기 경로 view 전환) 진입 전 drift 0건 연속 7일 검증 필수.
