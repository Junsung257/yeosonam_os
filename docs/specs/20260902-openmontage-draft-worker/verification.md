# Verification: OpenMontage draft sandbox

## Automated Checks

```bash
npm run check:openmontage-worker
npx vitest run src/lib/video-worker/contracts.test.ts
docker compose -f tools/openmontage-worker/compose.yaml config --quiet
npm run check:harness
```

## Manual QA

- [x] Confirmed no upstream Skill installation, DB migration, API route, upload, social publish, paid provider, or public artifact.
- [ ] Build the image, capture its digest/SBOM, and run the offline preflight.
- [ ] Inspect three real drafts for claim accuracy, media rights, subtitles, safe area, loudness, watermark, and reference labels.

## Evidence To Report

- Test output: `review.md`
- DB/schema check: no migration or write surface
- Render proof: pending

## Approval Gates

- [x] Live rendering and any follow-up ledger design remain blocked until the unchecked criteria pass.
