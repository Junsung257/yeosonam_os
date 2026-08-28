import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const live = args.has('--live');
const checkUrls = args.has('--check-urls');
const strict = args.has('--strict');
const failures = [];
const warnings = [];
const checks = [];

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function requireContract(label, passed, detail) {
  checks.push({ label, passed });
  if (!passed) failures.push(`${label}: ${detail}`);
}

function trackedByGit(path) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const policy = read('src/lib/media-generation/policy.ts');
const mediaIndex = read('src/lib/media-generation/index.ts');
const persistence = read('src/lib/media-generation/persistence.ts');
const worker = read('src/lib/media-generation/worker.ts');
const workerAuth = read('src/lib/media-generation/worker-auth.ts');
const workerBridge = read('scripts/codex-media-job.mjs');
const middleware = read('src/middleware.ts');
const snapshot = read('src/lib/package-publication/public-snapshot.ts');
const cardNews = read('src/app/api/card-news/route.ts');
const homepage = read('src/app/page.tsx');
const blogImages = read('src/lib/blog-image-gen.ts');
const blogJobs = read('src/lib/blog-media-jobs.ts');
const migration = [
  read('supabase/migrations/20260828063117_media_assets_v1.sql'),
  read('supabase/migrations/20260828090056_media_codex_worker_v1.sql'),
].join('\n');

requireContract(
  'production env file is not tracked',
  !trackedByGit('.env.prod'),
  '.env.prod must remain local and ignored',
);
requireContract(
  'reality-required generation fails closed',
  policy.includes("assetClass === 'reality_required'") && policy.includes('must use supplier, official'),
  'policy must reject reality_required assets',
);
requireContract(
  'subscription generation has no image API-key path',
  !mediaIndex.includes('OPENAI_API_KEY')
    && !mediaIndex.includes('/v1/images/generations')
    && !persistence.includes('OPENAI_API_KEY')
    && !workerBridge.includes('OPENAI_API_KEY'),
  'the media runtime and local bridge must use only the built-in Codex image tool',
);
requireContract(
  'subscription generation is capped, leased, and idempotent',
  persistence.includes('idempotency_key')
    && persistence.includes('readCodexDailyUsage')
    && persistence.includes('MEDIA_CODEX_DAILY_LIMIT')
    && persistence.includes('lease_expires_at')
    && persistence.includes('attempt_count')
    && persistence.includes('claim_codex_media_job_v1')
    && migration.includes('FOR UPDATE SKIP LOCKED')
    && migration.includes('pg_advisory_xact_lock'),
  'durable identity, daily allowance accounting, leases, and attempt caps are required',
);
requireContract(
  'worker uses a dedicated bearer secret and server-side completion',
  workerAuth.includes("getSecret('MEDIA_CODEX_WORKER_TOKEN')")
    && workerAuth.includes('timingSafeEqual')
    && worker.includes('expectedLeaseOwner')
    && worker.includes('completeMediaAsset')
    && worker.includes('normalizeAndInspectMediaImage')
    && worker.includes('workerVisualQaPassed')
    && workerBridge.includes('--visual-qa-passed'),
  'the Codex worker must not reuse cron or admin credentials and must persist through the server',
);
requireContract(
  'worker bridge cannot mistake login HTML for a successful claim',
  workerBridge.includes("redirect: 'manual'")
    && workerBridge.includes('returned non-JSON')
    && middleware.includes("pathname.startsWith('/api/internal/media/codex/jobs/')")
    && middleware.includes("request.headers.get('authorization')"),
  'middleware must pass dedicated Bearer-shaped requests and the bridge must fail closed on redirects/HTML',
);
requireContract(
  'generated assets are excluded from package evidence',
  snapshot.includes('openai_generated|code_rendered')
    && snapshot.includes('never enter images_public'),
  'package images_public must reject generated and code-rendered media',
);
requireContract(
  'product card news uses public snapshot images only',
  cardNews.includes('verifiedPackageImageUrls')
    && cardNews.includes('상품 카드에는 public snapshot의 검증된 실사만 사용')
    && !cardNews.includes('searchPexelsPhotos'),
  'product slides must not search or synthesize replacement photos',
);
requireContract(
  'homepage consumes approved campaign media only',
  homepage.includes('getLatestApprovedMediaAsset')
    && homepage.includes("purpose: 'home_campaign_hero'"),
  'home campaign media must pass the media review ledger',
);
requireContract(
  'blog publication is code-first with an asynchronous subscription upgrade',
  blogImages.includes('renderDeterministicMedia')
    && !blogImages.includes('generateConceptualMedia')
    && blogJobs.includes('enqueuePublishedBlogCover')
    && blogJobs.includes('enqueueConceptualMedia')
    && blogJobs.includes("status !== 'published'"),
  'normal publication must remain deterministic while published rows may enqueue one Codex cover upgrade',
);
requireContract(
  'media ledger is service-role only',
  migration.includes('ENABLE ROW LEVEL SECURITY')
    && migration.includes('REVOKE ALL ON TABLE public.media_assets FROM PUBLIC, anon, authenticated')
    && migration.includes('TO service_role'),
  'browser roles must not read or mutate the provenance ledger',
);
requireContract(
  'media ledger supports the durable Codex worker state machine',
  migration.includes("provider IN ('openai', 'codex_builtin', 'code')")
    && migration.includes("'generating'")
    && migration.includes("'pending_review'")
    && migration.includes('lease_owner')
    && migration.includes('next_attempt_at'),
  'the additive migration must preserve historical rows and add claim/retry state',
);
requireContract(
  'public storage is bounded to WebP',
  migration.includes('6291456') && migration.includes("ARRAY['image/webp']::text[]"),
  'bucket must enforce the normalized format and maximum size',
);

if (live) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    failures.push('live ledger audit requires NEXT_PUBLIC_SUPABASE_URL and a server service key');
  } else {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.from('media_assets')
      .select('id, owner_type, asset_class, source_kind, provider, public_url, storage_path, sha256, prompt_version, status, qa_report, source_metadata, attempt_count, lease_expires_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      failures.push(`live ledger query failed: ${error.message.slice(0, 160)}`);
    } else {
      const rows = data ?? [];
      for (const row of rows) {
        const generated = row.source_kind === 'openai_generated' || row.source_kind === 'code_rendered';
        if (row.source_kind === 'openai_generated' && row.asset_class !== 'conceptual_allowed') {
          failures.push(`live asset ${row.id} violates the conceptual-only AI boundary`);
        }
        if (row.provider === 'codex_builtin' && row.source_kind !== 'openai_generated') {
          failures.push(`live asset ${row.id} has an invalid Codex provenance pairing`);
        }
        if (row.provider === 'codex_builtin' && (row.attempt_count ?? 0) > 2) {
          failures.push(`live asset ${row.id} exceeds the worker attempt cap`);
        }
        if (
          row.provider === 'codex_builtin'
          && ['approved', 'pending_review'].includes(row.status)
          && row.source_metadata?.worker_visual_qa?.passed !== true
        ) {
          failures.push(`live asset ${row.id} lacks explicit worker visual QA evidence`);
        }
        if (generated && row.owner_type === 'package') {
          failures.push(`live asset ${row.id} attaches generated media to a package owner`);
        }
        if (row.status === 'approved') {
          if (!/^https:\/\//i.test(row.public_url ?? '')) failures.push(`approved asset ${row.id} has no public HTTPS URL`);
          if (!row.storage_path || !/^[0-9a-f]{64}$/i.test(row.sha256 ?? '')) failures.push(`approved asset ${row.id} lacks immutable storage evidence`);
          if (!row.prompt_version || row.qa_report?.passed !== true) failures.push(`approved asset ${row.id} lacks prompt or QA evidence`);
        }
      }
      if (checkUrls) {
        const approvedUrls = rows
          .filter((row) => row.status === 'approved' && /^https:\/\//i.test(row.public_url ?? ''))
          .slice(0, 50);
        for (const row of approvedUrls) {
          try {
            const response = await fetch(row.public_url, { method: 'HEAD', signal: AbortSignal.timeout(8_000) });
            if (!response.ok) failures.push(`approved asset ${row.id} public URL returned ${response.status}`);
          } catch {
            failures.push(`approved asset ${row.id} public URL could not be reached`);
          }
        }
      }
      checks.push({ label: `live media ledger rows checked: ${rows.length}`, passed: true });
    }
  }
} else {
  warnings.push('live DB and public URL checks were not run; use --live --check-urls with server env when deploying');
}

for (const check of checks) {
  console.log(`${check.passed ? 'PASS' : 'FAIL'}  ${check.label}`);
}
for (const warning of warnings) console.warn(`WARN  ${warning}`);
for (const failure of failures) console.error(`FAIL  ${failure}`);

if (failures.length > 0 || (strict && warnings.length > 0)) process.exitCode = 1;
else console.log(`\nMedia generation contract passed (${checks.length} checks).`);
