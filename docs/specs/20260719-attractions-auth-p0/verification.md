# Verification

- Focused route tests: 3/3 passed.
- Changed-file ESLint: passed.
- `git diff --check`: passed.
- Unauthenticated `GET` and `PATCH` return 401 before DB access.
- Authenticated responses include `private, no-store`.
- Matching, seeding, alias, INSERT, and candidate-generation logic is unchanged.
