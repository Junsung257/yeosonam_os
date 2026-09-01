---
name: blog-media-worker
description: Process one queued Yeosonam blog or campaign media job using the ChatGPT subscription built-in image generator, then upload and verify it through the repository worker bridge. Use for scheduled or manual Codex media-worker runs. Never use an OpenAI API key, image API, stock-photo fallback, or direct database write.
---

# Blog Media Worker

Process exactly one durable media job per invocation. The publication-safe code-rendered cover remains visible until this workflow finishes, so an empty queue or generation failure is safe.

## Required boundaries

- Invoke `$imagegen` and use its **built-in tool mode**. This consumes the signed-in ChatGPT/Codex subscription allowance and does not require `OPENAI_API_KEY`.
- Never use the imagegen CLI/API fallback, Pexels, another stock provider, or a direct Supabase write.
- Never print or copy `MEDIA_CODEX_WORKER_TOKEN` into chat, files, logs, or commands.
- Do not edit tracked repository files. A generated image is staging data only until the server normalizes, stores, audits, and attaches it.
- Process no more than one claimed job, even if more jobs are waiting.

## Workflow

1. From the repository root, run:

   `npm run media:codex-worker -- claim`

2. Parse the single JSON line. If `job` is `null`, report that the queue is empty and stop successfully. Preserve `worker_run_id`, `job.id`, and `job.prompt` exactly.
3. Call the built-in image generation tool once using `job.prompt`. Do not add factual claims, logos, text, landmarks, named hotels, aircraft, or people beyond what the server prompt permits.
4. Inspect the displayed result before uploading. Pass only when there is no readable text, logo, watermark, identifiable person, recognizable hotel/aircraft/restaurant/attraction/landmark, factual chart, distorted object, or other violation of `job.prompt`. If it fails, report `visual_policy_failed`; do not upload it.
5. Use the generated result's output hint to locate the selected file under `$CODEX_HOME/generated_images/...`. Copy it to `.codex/media-staging/<job.id>.<original-extension>` without overwriting another job's file.
6. Complete the job and explicitly attest that the visual inspection passed:

   `npm run media:codex-worker -- complete --job-id <job.id> --worker-run-id <worker_run_id> --file <staging-path> --visual-qa-passed`

7. Verify the durable result:

   `npm run media:codex-worker -- verify --job-id <job.id>`

   Success means the returned job status is `approved` (automatic attachment) or `pending_review` with an HTTPS `public_url` (manual review).
8. Report only the job ID, final status, purpose, and public URL. Do not include the secret or full server prompt.

## Failure handling

If built-in generation is unavailable, allowance-limited, or produces no usable local file, release the lease with one of these safe error codes:

- `subscription_limit`
- `builtin_imagegen_unavailable`
- `generation_failed`
- `artifact_missing`
- `visual_policy_failed`

Run:

`npm run media:codex-worker -- fail --job-id <job.id> --worker-run-id <worker_run_id> --error-code <code>`

Then stop. Do not switch providers or retry generation in the same invocation. The server controls the next retry time and total attempt cap.
