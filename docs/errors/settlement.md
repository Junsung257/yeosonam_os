# Settlement and Ledger Errors

Last updated: 2026-08-05

## ERR-SETTLEMENT-REVIEW-QUEUE-FALSE-ZERO@2026-08-05

- **Symptom:** The transaction-review tab showed one fully allocated Clobe memo-change warning while the finance home showed `여행 메모·배분 오류 0건`.
- **Root cause:** The home action count checked allocation remainder only and ignored `bank_transactions.match_status`. It also added over-allocation to a count that already included it, allowing future double counting.
- **Permanent rule:** Count source transactions requiring attention by the union of review statuses and allocation mismatch, never by adding overlapping counters.
- **Required proof:** A fully allocated `review` row counts once, a reviewed under-allocation still counts once, a fully allocated confirmed row counts zero, and non-travel rows do not enter the travel action count.

## ERR-SETTLEMENT-EXCEPTION-AUDIT-FIELDS-ERASED@2026-08-05

- **Symptom:** Resolving a monthly settlement exception removed its assignee, reason, and due date from the permanent record.
- **Root cause:** The PATCH route converted omitted request fields to `null` instead of distinguishing “not supplied” from “clear this field”. Completed-month preview exceptions also remained transient until an operator performed a new conditional close.
- **Permanent rule:** Exception updates are patch semantics. Preserve responsibility fields unless explicitly supplied, and materialize completed-month financial exceptions after authoritative Clobe sync. Auto-resolve system-created rows with audit evidence; never delete them.
- **Required proof:** A status-only resolution retains responsibility fields, all completed-month no-evidence/drift/zero/negative rows appear in the persistent queue, and a repaired automatic exception moves to resolved without disappearing from history.

## ERR-SETTLEMENT-CLOSE-SILENT-REWRITE@2026-08-05

- **Symptom:** Booking-level confirmation existed, but there was no locked month snapshot. A later Clobe memo or allocation change could alter the displayed confirmed margin without a visible month-level exception.
- **Root cause:** `bookings.settlement_confirmed_at` represented an operator decision but did not preserve the reviewed transaction set, totals, source fingerprint, month revision, or reopen audit reason.
- **Permanent rule:** Close exactly one departure month into immutable `settlement_period_items`. Reopening keeps the old revision and requires a super-admin reason. A source change after close creates `post_close_change`; it never rewrites the locked snapshot.
- **Required proof:** Duplicate close returns the same period, concurrent close is serialized, item update/delete is rejected, conditional close requires owner/reason/due date, reopen is role-gated, and a changed memo or allocation creates one open exception.

## ERR-SETTLEMENT-PROVIDER-CATEGORY-AS-FINAL@2026-08-05

- **Symptom:** Clobe company-transaction labels were treated as final accounting decisions, while owner withdrawals, transfers, capital, and operating expenses could not be corrected without overwriting provider evidence.
- **Root cause:** Provider classification and OS-confirmed classification shared one field and had no precedence or non-retroactive rule ledger.
- **Permanent rule:** Preserve the Clobe original label and store the OS decision separately. Resolve in the order manual > OS rule > Clobe > review. New rules affect future transactions only by default; capital, transfers, and owner withdrawals never enter profit.
- **Required proof:** Manual classification wins over a matching rule, a new rule does not alter old transactions, unresolved company cash blocks safe withdrawal, and source classification remains unchanged after OS confirmation.

## ERR-SETTLEMENT-CASH-POSITION-AS-PROFIT@2026-08-05

- **Symptom:** Matched booking rows labeled `customer deposits - supplier payouts` as realized profit, including future trips holding customer funds and bookings funded in advance by the company.
- **Root cause:** The shared accounting result named the cash difference `cashProfit`, allowing presentation code to treat a reconciled cash position as earned profit.
- **Permanent rule:** Name this value `cashPosition` throughout code and label it `현금 순포지션`. Only a booking with `settlement_confirmed_at` may contribute to settlement-confirmed profit.
- **Required proof:** A future booking with a deposit, a company-prefunded booking, and a settled booking all show cash position in transaction rows; only the settled booking contributes to the separate confirmed-profit KPI.

## ERR-SETTLEMENT-BOOKING-DRAWER-API-ENVELOPE@2026-08-03

- **Symptom:** A booking row showed correct bank totals, but opening its settlement drawer displayed an empty blueprint and no matched bank transactions.
- **Root cause:** The drawer read the legacy `{ booking }` shape while `/api/bookings?id=...` returns `{ ok, data: { booking } }`.
- **Permanent rule:** Booking list and detail consumers must use the shared API response extractors; a failed detail request must render an explicit error instead of a false empty settlement.
- **Required proof:** Open a known memo-created booking and verify its booking identity, matched deposit and withdrawal rows, realized profit, and ledger link.

## ERR-SETTLEMENT-MOBILE-OUTFLOW-SIGN@2026-08-03

- **Symptom:** A mobile transaction detail displayed a 1,342,700 KRW withdrawal with a plus sign and deposit color.
- **Root cause:** The amount presentation was hard-coded as positive even though the route already loaded `transaction_type`.
- **Permanent rule:** Every transaction amount display derives its sign and tone from the transaction direction; never infer direction from the current tab or hard-code a sign.
- **Required proof:** Open a known deposit and withdrawal in mobile admin and verify their signs, colors, timestamps, and linked booking values.

## ERR-SETTLEMENT-FREE-TRAVEL-DOUBLE-AUTH@2026-08-03

- **Symptom:** The free-travel OTA settlement page showed `data load failed` for a signed-in administrator.
- **Root cause:** Two browser-facing routes required both the admin session guard and a separate API token that the admin browser does not send.
- **Permanent rule:** Browser-facing `/api/admin/**` settlement routes use `withAdminGuard`; do not add an internal API-token gate inside the already guarded handler.
- **Required proof:** Load commissions, reports, and unmatched queues from a signed-in admin browser, then verify upload and manual-resolution routes remain protected by `withAdminGuard`.

## ERR-SETTLEMENT-TAX-RLS-EMPTY@2026-08-03

- **Symptom:** The tax settlement page showed zero July bookings while 22 active July bookings existed in production.
- **Root cause:** The authenticated admin API queried with the anonymous database client, so RLS hid the booking rows.
- **Permanent rule:** An API guarded by `requireAdminRequest` must use the server admin client for its protected settlement query, and the UI must not convert a failed request into a false zero state.
- **Required proof:** Compare the month count with a direct database count, then verify the tax table and KPI cards load without an error state.

## ERR-SETTLEMENT-BOOKING-LIST-API-ENVELOPE@2026-08-03

- **Symptom:** Switching the reservation lifecycle tab replaced a valid 91-row list with zero rows, so memo-matched bookings could not be inspected in the settlement UI.
- **Root cause:** The client reload path read the legacy `{ bookings }` response while `/api/bookings` returns the standard `{ ok, data: { bookings } }` envelope.
- **Permanent rule:** Every booking-list consumer must use `extractBookingsFromApi`; a failed request must keep the last valid list instead of silently replacing it with an empty array.
- **Required proof:** Switch active/completed tabs, search a known memo-created booking, and verify the count and rendered rows remain aligned after the API reload.

## ERR-SETTLEMENT-REVIEW-TIMEZONE@2026-08-03

- **Symptom:** The `통장 메모 확인` queue showed all non-travel rows instead of the review subset, and ledger timestamps appeared nine hours earlier than Clobe.
- **Root cause:** The queue changed only the top-level tab without applying the memo-review predicate. Ledger dates also sliced UTC ISO strings instead of converting them to Korea time.
- **Permanent rule:** Queue counts and drill-down results must use the same predicate. Bank and settlement timestamps must be formatted with an explicit `Asia/Seoul` time zone through the shared formatter.
- **Required proof:** Verify the queue count equals its rendered rows, the all-non-travel view remains complete, a known UTC timestamp renders as KST in payments, ledger, booking drawer, mobile detail, and settlement bundle surfaces, and all settlement tabs load without hydration errors.

## ERR-SETTLEMENT-UNPRICED-NEGATIVE-BALANCE@2026-08-03

- **Symptom:** Memo-created bookings with `total_price = 0` displayed received money as a negative customer balance.
- **Root cause:** The booking table rendered `total_price - paid_amount` without first checking whether a sales price existed.
- **Permanent rule:** An unpriced booking has an unknown receivable, not a negative receivable. Continue showing its bank cashflow, but label customer balance as `가격 미입력` until the sales price is entered.
- **Required proof:** A zero-price booking with a deposit shows `가격 미입력`; priced underpayment and overpayment still show non-negative receivables.

## ERR-SETTLEMENT-FILTERED-VIRTUAL-TABLE-EMPTY@2026-08-03

- **Symptom:** Reservation search reported matching rows, but the virtualized result area was visually empty after switching status tabs.
- **Root cause:** The table retained the previous scroll offset while the filtered list became shorter, producing a virtual slice beyond the new result range.
- **Permanent rule:** Search, lifecycle, queue, data-quality, date-target, and sort changes reset the reservation table scroll offset before rendering the new virtual range.
- **Required proof:** Search a completed booking after viewing a longer list and verify the reported result count and rendered rows agree.

## ERR-SETTLEMENT-MEMO-SEPARATOR-GAP@2026-08-03

- **Symptom:** A real travel payout with memo `260505_서진혜-더투어` stayed in non-travel even though the same booking already had the canonical key.
- **Root cause:** The parser accepted underscores only, so one customer/operator separator typo hid the payout from booking profit.
- **Permanent rule:** Normalize a constrained separator variant to the canonical key only when it resolves to an existing key or unambiguous booking. Never auto-create a booking from the variant.
- **Required proof:** The variant resolves to the canonical key, its existing Clobe row is allocated exactly once, and the booking/ledger drift remains zero after sync.

## ERR-CLOBE-TRAVEL-NET-AS-BANK-BALANCE@2026-08-03

- **Symptom:** `/admin/payments` labeled matched travel deposits minus matched travel outflows as the current bank balance, while company expenses and memo-less rows were absent.
- **Root cause:** the Clobe importer intentionally skipped every row without a valid travel key. In the 4128 statement this retained 263 travel rows but discarded 175 real bank movements, so `34,897,644` KRW travel net was shown instead of the `23,436,327` KRW provider balance.
- **Permanent rule:** authoritative Clobe sync is lossless. Store every provider transaction exactly once and separate `travel` booking settlement from `non_travel` bank reality with an explicit scope.
- **Required proof:** full statement count, total inflow, total outflow, provider after-balance, computed closing balance, travel net, non-travel net, provider-id uniqueness, allocation uniqueness, and ledger drift must all pass independently.
- **Deployment lesson:** a dirty CLI production deployment from a stale feature branch replaced the merged settlement release on 2026-08-03. Production verification must confirm the deployed Git ref/SHA is current `main` before UI results are accepted.

## ERR-CLOBE-ORPHAN-RESET@2026-08-02

- Authoritative Clobe rebuilds must finish with a full booking-to-ledger drift audit, including bookings that receive no replacement Clobe transaction.
- A reset ledger entry must never be left by itself when the booking field is already zero. Preserve the reset evidence and add an idempotent compensating entry instead of deleting financial history.
- Do not report a rebuild as healthy until provider IDs, active allocations, booking pointers, transaction amounts, and booking ledger drift all pass independently.

## ERR-CLOBE-EXCLUDED-PROVIDER-ID@2026-08-02

- Excluded historical rows must not block an active Clobe row from claiming the same provider transaction identity.
- Keep excluded evidence immutable and scope the provider identity unique index to rows whose status is not `excluded`.
- Apply the same active-only boundary to the local transaction fingerprint unique index; both constraints can otherwise block the same replacement flow in sequence.
- A full-period sync must be verified by checking that active Clobe rows missing `external_transaction_id` decrease to zero; UI matched counts alone are not sufficient.

## ERR-SETTLEMENT-BANK-BALANCE-AS-SPENDABLE-PROFIT@2026-08-05

- **Symptom:** The finance dashboard showed the 4128 account balance and travel cash position without answering how much was earned or safely withdrawable, so customer advances could be mistaken for owner profit.
- **Root cause:** Raw bank cashflow, settlement-confirmed margin, company operating expenses, tax reserve, financing, refunds, and unresolved classifications were not joined by one owner-facing invariant.
- **Permanent rule:** Never label bank balance or open-booking net cash as profit. Safe withdrawal is capped by both protected-liquidity cash and after-tax snapshot profit minus company expense. Unknown supplier cost or reconciliation drift blocks withdrawal; unresolved inflows are fully protected until classified.
- **Required proof:** Reconcile provider balance, protected open-trip cash, settled travel profit, classified operating expenses, tax reserve, provisional company result, and safe withdrawal; verify the monthly profit chart contains settlement-confirmed bookings only.

## ERR-SETTLEMENT-REOPEN-HIDDEN-BOOKINGS@2026-08-05

- **Symptom:** A closed departure month could be reopened, but its bookings still had `settlement_confirmed_at`, so the reclose preview treated them as already confirmed and could create an empty revision.
- **Root cause:** Reopening changed only the period status and did not return the compatibility booking fields to the unconfirmed state. The first smoke test invoked the RPC directly and missed the API preview boundary.
- **Permanent rule:** Reopening must keep the old period items immutable, clear the compatibility settlement fields for exactly that period's bookings, and audit the before/after state. Reclosing creates a new period revision and reconfirms those bookings.
- **Required proof:** In one rollback transaction, reopen a real closed period, verify every snapshot booking returns to preview, reclose it into a new revision, verify every booking is reconfirmed, and confirm zero test rows remain.

정산, ledger, 입금, 은행/SMS 매칭, 세무, 지급 흐름 반복 오류 상세.

## ERR-LEDGER-drift@2026-04-30

> Original source before 2026-06-07 split: `db/error-registry.md:1002`

- [ ] **ERR-LEDGER-drift@2026-04-30** (재무 정합성 — Phase 2a 이중쓰기 drift 발생 시 응급 절차): `bookings.paid_amount / total_paid_out` 와 `SUM(ledger_entries.amount)` 가 일치해야 함 (Phase 2a 이중쓰기 보장). 일치하지 않으면 = ledger 우회 경로가 있다는 뜻 → 모든 매칭·환불·정산 신뢰도 붕괴. **검출**: ① 매일 03:30 UTC `/api/cron/ledger-reconcile` cron — drift > 0 발견 시 어드민 푸시 + Slack alert (SLACK_ALERT_WEBHOOK_URL) 동시 발송. ② `/admin/payments` 헤더 `LedgerStatusChip` (60s 폴링) 빨간 펄스 표시. ③ `/admin/payments/reconcile` 페이지에서 booking 단위 drift 즉시 조회. **응급 절차**: ① `/admin/payments/reconcile` 진입 → drift sample 20건 확인 → 어떤 source 누락 인지 BookingDrawer "📒 원장 보기" 로 ledger 시간순 비교. ② drift 원인이 ledger 우회 코드 경로(직접 UPDATE bookings.paid_amount 발견)면 **즉시 push 차단** + 핫픽스. ③ 영향 booking 들에 대해 `record_manual_paid_amount_change` RPC 로 ledger entry 보정 (memo 에 ERR-LEDGER-drift 인시던트 ID 명시). ④ 또는 어드민 "입금 재동기화" (resync_paid_amounts_with_ledger RPC) 로 일괄 보정 entry 자동 생성. **재발 방지**: ① bookings.paid_amount / total_paid_out 직접 UPDATE 코드를 추가하면 안 됨 — 모든 변경은 RPC (update_booking_ledger / record_manual_paid_amount_change / confirm_payment_match / create_land_settlement / reverse_land_settlement / resync_paid_amounts_with_ledger) 경유. ② 새 매칭/정산 경로 추가 시 idempotency_key 컨벤션 준수 (`<source>:<external_id>` 패턴). ③ ledger_entries 는 RLS service_role-only — 클라이언트 코드에서 anon key 로 조회 불가. ④ Phase 2b (읽기 경로 view 전환) 진입 전 drift 0건 연속 7일 검증 필수.

## ERR-CLOBE-provider-id-gap@2026-08-02

- [x] **증상:** Clobe 동기화가 매번 `duplicates 257`을 표시하고 거래 탭은 0건처럼 보이지만, 운영 DB에는 263건의 활성 거래와 배분 증빙이 존재했다.
- [x] **원인:** Excel bootstrap 시각에는 초가 있었고 Clobe MCP 시각은 분 단위였다. 초를 포함한 fingerprint가 달라 similarity 경로를 탔고, 이미 배분된 probable row는 provider transaction id를 붙이지 않은 채 duplicate로 종료됐다. 화면은 예약 KPI는 출발 월, 거래 탭은 입출금 월, 미매칭은 전체 기간으로 서로 다른 기준을 혼용했다.
- [x] **수정 계약:** provider id가 없는 기존 `clobe_mcp` 행은 같은 분·유형·금액·상대방·메모로 유일할 때만 provider id를 결합한다. 동일 분 거래가 여럿이면 메모로 구분하며, 메모도 모호하면 새 금융 행을 만들지 않고 검토로 남긴다. 결합 후 재동기화는 provider id exact match로 멱등이어야 한다.
- [x] **표시 계약:** 정상화 실패는 importer 오류와 별도 표시하고, 거래 탭은 전체 활성 원장 기준임을 명시한다. 제외 422건 같은 과거 Slack/SMS·재구성 전 Clobe 행은 정산 합계에서 빠지는 감사 보관 자료로 표시한다.

## ERR-SETTLEMENT-noop-sync-fingerprint@2026-08-11

- [x] **증상:** 예약 상세에는 최신 Clobe 금액이 보이지만 `정산 확인` 저장은 409로 실패했고, 매일 동기화 뒤 검토 지문 불일치가 누적됐다.
- [x] **원인:** `finance_booking_review_fingerprint`가 Clobe no-op merge에서도 바뀌는 `bank_transactions.updated_at`을 포함했으며 API는 현재 원장이 아니라 저장된 오래된 지문을 반환했다.
- [x] **수정 계약:** 정산 지문에는 운영상 의미 있는 필드만 포함한다. API는 `finance_booking_review_live_snapshots`의 현재 지문을 반환한다. 버전 변경 백필은 결정 상태를 유지하고 불변 사전 스냅샷을 남긴다.
- [x] **검증:** 운영 DB 기준 지문 drift 26건에서 0건, 취소 예약 숨은 pending 2건에서 0건. 통장 479건과 배분 합계는 변경 전후 모두 1원 차이 0건.

## ERR-SETTLEMENT-reserve-double-count@2026-08-11

- [x] **증상:** `지금 써도 되는 돈`에서 출발 전 고객 돈과 같은 예약의 미지급 랜드사 원가를 모두 차감해 실제보다 과도하게 낮게 표시할 수 있었다.
- [x] **원인:** 예약별 계산은 이미 두 금액 중 큰 값을 구했지만 최종 ERP 요약이 두 합계를 다시 더했다.
- [x] **수정 계약:** 열린 예약마다 `max(고객 보유금, 남은 예정원가)`만 보호하고 미배정 여행 입금만 추가한다. 원가 미입력은 계속 사용가능액을 차단한다.

## ERR-SETTLEMENT-loading-false-zero@2026-08-11

- [x] **증상:** 거래 API 실패 또는 최초 로딩 중 실제 원장이 있어도 0건·0원처럼 보일 수 있었다.
- [x] **원인:** 여러 fetch의 HTTP 오류를 검사하지 않았고 실패 상태와 유효한 빈 상태를 분리하지 않았다.
- [x] **수정 계약:** 최초 로딩에는 skeleton만 표시하고, 하나의 API라도 실패하면 명확한 오류를 표시한다. 기존 정상 데이터가 있으면 유지하면서 마지막 정상 시각을 함께 보여준다.

## ERR-CLOBE-memo-review-repeat@2026-08-12

- [x] **증상:** 실제 Clobe 메모가 바뀌지 않은 재동기화에서도 기존 배분 거래 86건이 매번 `메모 검토`로 다시 집계됐다.
- [x] **원인:** 변경 감지가 마지막으로 저장한 Clobe 원본 메모가 아니라 이관 전 `bank_transactions.memo`와 현재 Clobe 메모를 비교했다. 메모 제거도 이미 확인했는지 구분하지 않고 매번 검토로 처리했다.
- [x] **수정 계약:** 공급자별 `source_metadata`에 마지막으로 관측한 메모와 여행키가 있으면 이를 비교 기준으로 사용한다. 공급자 증빙이 아직 없을 때만 기존 거래 메모로 폴백하며, 여행 메모 제거는 공급자별 최초 1회만 검토로 생성한다.
- [x] **검증:** 같은 공급자 메모의 두 번째 동기화는 `memoChangedReview = 0`이어야 하고, 신규 메모 변경은 1회만 검토로 남아야 한다. 예약 검토 지문 drift와 배분 부족·초과는 계속 0건이어야 한다.
