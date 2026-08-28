# Codex Media Operations — Tasks

## P0

- [x] Audit `.env.prod` without printing values.
- [x] Ignore and untrack `.env.prod` while preserving the local file.
- [ ] Rotate historical credentials in their owning external services.
- [ ] Confirm GitHub secret scanning/history remediation policy with the repository owner.
- [x] Publish the media SSOT and add it to `AGENTS.md`.

## P1 implementation

- [x] Add the three-class media policy.
- [x] Add `media-brief-v1`, manifest types, prompt versioning, and idempotency.
- [x] Add Codex built-in queue/lease worker with KST daily claim and two-attempt limits.
- [x] Add WebP normalization, dimension/MIME/size QA, hashes, and OG variant.
- [x] Add durable media ledger and immutable Storage migration.
- [x] Add deterministic information/CTA card rendering.
- [x] Integrate blog, homepage, product snapshot, and card-news surfaces.
- [x] Add public AI disclosure across blog and homepage surfaces.
- [x] Add admin review and one-regeneration replacement flow.
- [x] Add focused tests and `audit:media-generation`.
- [x] Add the one-job worker bridge, internal API, and validated local Codex skill.

## Deployment and observation

- [x] Apply the two media migrations and Storage bucket directly through the linked Supabase query path; record only those two versions because normal `db push` is blocked by historical migration drift.
- [x] Configure the dedicated worker token, daily cap, lease, and rollout variables in Vercel and Windows with generation disabled until app deployment.
- [x] Create the local Codex recurring automations in paused state.
- [x] Complete one `OPENAI_API_KEY`-free built-in ImageGen `social_og` canary through claim, upload, QA, Storage, and verify.
- [x] Run the equivalent of `npm run audit:media-generation:live`; 14 contract checks and the public URL passed.
- [ ] Deploy the app code from a clean release and then enable the two recurring automations.
- [ ] Capture authenticated admin, desktop, and mobile public-render proofs.
- [ ] Run the 14-day canary and record success, approval, rejection, allowance-limit, retry, and incident rates.
- [ ] Increase rollout only after every canary gate passes.

## Deferred

- [ ] Supplier-photo derivative pipeline with snapshot hash and automatic stale invalidation.
- [x] OG, 1:1, and 4:5 code-cropped variants from one generated master.
- [ ] 9:16 derivative after a safe-area policy is validated for the much narrower crop.
- [ ] OCR/visual similarity evaluation and a media operations KPI dashboard.
- [ ] Agent task/trace/incident correlation for long-running provider jobs if synchronous volume becomes insufficient.
