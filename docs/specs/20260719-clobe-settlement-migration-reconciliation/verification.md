# Verification

## Read-only production evidence

- Linked history contains `20260718130947` and `20260718131027`.
- Linked history does not contain the old local-only versions
  `20260714121025` or `20260718120000`.
- Remote schema contains `booking_settlement_keys`,
  `bank_transactions.external_provider`,
  `bank_transactions.external_transaction_id`,
  `bank_transactions.raw_payload`,
  `uq_bank_transactions_external_provider_tx`, and
  `idx_bank_transactions_clobe_sync_lookup`.
- Remote schema does not contain
  `idx_booking_settlement_keys_land_operator`.

## Required gates

- `npx supabase migration list --linked`
- `node scripts/migration-safety-checker.js --base origin/main --head HEAD`
- `npm run audit:migration-prefix:ci`
- `git diff --check`

Production was not mutated during this reconciliation.
