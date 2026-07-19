# Clobe settlement migration reconciliation

## Goal

Align the repository migration versions with the versions already recorded by
the linked production Supabase project, without mutating production while the
release audit is running.

## Evidence

- Remote history records `20260718130947_booking_settlement_keys` and
  `20260718131027_clobe_bank_transaction_sync_allow_existing_sms`.
- The repository used earlier local-only versions `20260714121025` and
  `20260718120000` for the same SQL changes.
- A read-only remote schema dump confirms the table, Clobe columns, and Clobe
  indexes already exist.
- The supporting index for `booking_settlement_keys.land_operator_id` is not
  present remotely.

## Safety boundary

- Do not repair, push, or mutate remote migration history in this task.
- Mirror the recorded production versions locally.
- Add the missing support index only as a new forward migration using
  `CREATE INDEX CONCURRENTLY`.
