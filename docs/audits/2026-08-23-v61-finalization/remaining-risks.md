# V6.1 finalization remaining risks

## Gate decision

`NO-GO`. The V6.1 engine and authority contract are structurally green in the dedicated worktree, but Gold certification is not proven.

## Evidence gaps

- The full private corpus metadata is not a source archive: 1,131 of its 1,171 referenced source paths are unavailable in the current filesystem. Missing originals cannot be substituted with metadata, parser output, or synthetic text.
- The currently hash-verifiable candidate inventory is 40 sources and 69 travel-product sections, with 10 frozen sections. It cannot satisfy the 400-section target.
- The existing 164-case frozen queue has no available source files and contains no Reviewer A, Reviewer B, or adjudicator records.
- Runtime Supabase admin preflight is unavailable. No operational DB baseline, customer-pointer freeze manifest, logical export, RLS/CAS/fencing result, or production-readiness evidence was obtained.
- The supplied RC2 and RC2.1 resume SHAs are not ancestors of the current authority HEAD (`c2f04a5e...`, parent `7e189aae...`). This ancestry discrepancy must be reconciled before treating a prior resume ledger as authoritative.

## Carry-forward engineering debt

The two stale C12 regression fixtures remain separate test debt. They must be fixed only in a small child commit by freezing the test clock or using explicitly future fixture dates. Production date filtering must not be weakened as a workaround. No source code was changed in this session.

## Required next resume

1. Acquire the missing original source files through the approved human/operator path.
2. Rebuild a source inventory and verify hashes against the actual bytes.
3. Produce 400 or more candidate sections with complete price and departure ground truth.
4. Run independent blind Reviewer A and Reviewer B submissions.
5. Adjudicate every disagreement and freeze the immutable Gold version.
6. Run the V6.1 benchmark and evaluate every certificate condition.
7. Request the exact production approval string only after all non-production gates pass.
