# Plan

1. Compare linked migration history and remote schema read-only.
2. Replace local-only migration versions with the recorded production versions.
3. Add one forward-only concurrent index migration for the missing FK index.
4. Run migration history, safety, prefix, SQL, and PR checks.
5. Keep production writes approval-gated.
