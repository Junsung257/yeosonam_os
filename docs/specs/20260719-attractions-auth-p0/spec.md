# Attractions candidate admin boundary

## Goal

Prevent unauthenticated and non-admin callers from reading or mutating the
internal entity-master candidate review queue.

## Scope

- Guard `GET` and `PATCH` with the existing admin authorization contract.
- Mark every response private and non-cacheable.
- Add route-level regression coverage.

## Exclusions

- No attraction seeding, matching, alias, candidate generation, or database
  insert changes.
- No production data mutation.
