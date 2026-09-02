import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BlogProductionReadinessInputV4 } from '../src/lib/blog-production-readiness-v4';

type Inventory = {
  columns: Array<{ table_name: string; column_name: string }>;
  tables: string[];
  views: string[];
  functions: string[];
  present_migrations: string[];
};

type CorpusEvidence = {
  public_eligible: number;
  current_snapshots: number;
  missing_snapshot_slugs: string[];
  review_blocked_published: number;
  review_blocked_with_disposition: number;
  queued_without_verified_demand: number;
  due_queued_without_verified_demand: number;
  sample_slug: string | null;
  gsc_rows_90d: number;
  gsc_latest_metric_date: string | null;
  engagement_rows_7d: number;
  rum_rows_7d: number;
  analytics_canary_passed_at: string | null;
  natural_attributed_events_30d: number;
  outbox_dead: number;
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runLinkedReadOnlyQuery<T>(sql: string): T {
  const statement = sql.trim().replace(/\s+/g, ' ');
  if (/\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|call)\b/i.test(statement)) {
    throw new Error('production evidence collector accepts SELECT statements only');
  }
  const options = {
    encoding: 'utf8' as const,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };
  // Supabase CLI agent auto-detection can suppress db-query rows in headless CI.
  // Pin the reviewed CLI and force its structured agent output on both platforms.
  const stdout = process.platform === 'win32'
    ? execFileSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$query = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(statement, 'utf8').toString('base64')}')); $nodeExe = (Get-Command node).Source; $npxCli = Join-Path (Split-Path $nodeExe) 'node_modules\\npm\\bin\\npx-cli.js'; & $nodeExe $npxCli --yes supabase@2.116.0 db query --linked --output-format json --agent yes $query`,
      ], options)
    : execFileSync('npx', [
        '--yes',
        'supabase@2.116.0',
        'db',
        'query',
        '--linked',
        '--output-format',
        'json',
        '--agent',
        'yes',
        statement,
      ], options);
  const parsed = JSON.parse(stdout) as { rows?: Array<{ evidence?: T }> };
  const value = parsed.rows?.[0]?.evidence;
  if (value == null) throw new Error('linked evidence query returned no payload');
  return value;
}

function hasColumn(inventory: Inventory, table: string, column: string): boolean {
  return inventory.columns.some((row) => row.table_name === table && row.column_name === column);
}

async function checkSurface(
  url: string,
  validate: (body: string, type: string) => string | null,
  expectedStatus = 200,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'YeosonamBlogProductionEvidenceV4/1.0' },
    });
    const body = await response.text();
    const reason = response.status !== expectedStatus
      ? `http_${response.status}_expected_${expectedStatus}`
      : validate(body, response.headers.get('content-type') || '');
    return reason ? `${url}:${reason}` : null;
  } catch (error) {
    return `${url}:${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timeout);
  }
}

function numberArgument(name: string): number | null {
  const value = argument(name);
  return value != null && /^\d+$/.test(value) ? Number(value) : null;
}

async function main(): Promise<void> {
  if (process.argv.includes('--apply')) throw new Error('production evidence collection is permanently read-only');
  const manifestPath = resolve('supabase/release-manifests/blog-orchestrator-v4-20260816.json');
  if (!existsSync(manifestPath)) throw new Error('blog_v4_release_manifest_missing');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    migrations: Array<{ version: string }>;
  };
  const requiredMigrations = manifest.migrations.map((entry) => entry.version);
  const inventory = runLinkedReadOnlyQuery<Inventory>(`
    select json_build_object(
      'columns', coalesce((select json_agg(json_build_object('table_name', table_name, 'column_name', column_name)) from information_schema.columns where table_schema = 'public'), '[]'::json),
      'tables', coalesce((select json_agg(table_name) from information_schema.tables where table_schema = 'public'), '[]'::json),
      'views', coalesce((select json_agg(table_name) from information_schema.views where table_schema = 'public'), '[]'::json),
      'functions', coalesce((select json_agg(proname) from pg_proc where pronamespace = 'public'::regnamespace), '[]'::json),
      'present_migrations', coalesce((select json_agg(version order by version) from supabase_migrations.schema_migrations where version = any(array[${requiredMigrations.map(sqlLiteral).join(',')}])), '[]'::json)
    ) as evidence
  `);
  const requiredCapabilities = [
    'public_eligibility_view',
    'public_slug_registry',
    'legacy_public_slug_rpc_absent',
    'generation_selected_attempt',
    'attempt_finish_reason',
    'ai_budget_ledger',
    'rollout_state_store',
    'durable_public_snapshots',
    'search_performance',
    'analytics_attribution',
    'engagement_and_rum',
  ];
  const presentCapabilities = [
    inventory.views.includes('public_blog_content_creatives') ? 'public_eligibility_view' : null,
    inventory.views.includes('public_blog_slug_registry') ? 'public_slug_registry' : null,
    !inventory.functions.includes('is_blog_public_slug_eligible_v3') ? 'legacy_public_slug_rpc_absent' : null,
    hasColumn(inventory, 'blog_generation_runs', 'selected_attempt_id') ? 'generation_selected_attempt' : null,
    hasColumn(inventory, 'blog_generation_attempts', 'finish_reason') ? 'attempt_finish_reason' : null,
    inventory.tables.includes('blog_ai_budget_reservations') ? 'ai_budget_ledger' : null,
    inventory.tables.includes('blog_publication_rollout_state')
      && inventory.tables.includes('blog_publication_rollout_evaluations') ? 'rollout_state_store' : null,
    inventory.tables.includes('blog_public_snapshots') ? 'durable_public_snapshots' : null,
    inventory.tables.includes('blog_search_performance') ? 'search_performance' : null,
    inventory.tables.includes('analytics_server_events')
      && hasColumn(inventory, 'analytics_server_events', 'assisting_content_creative_id') ? 'analytics_attribution' : null,
    inventory.tables.includes('blog_engagement_logs') && inventory.tables.includes('web_vitals') ? 'engagement_and_rum' : null,
  ].filter((value): value is string => Boolean(value));

  const corpus = runLinkedReadOnlyQuery<CorpusEvidence>(`
    select json_build_object(
      'public_eligible', (select count(*) from public.public_blog_content_creatives),
      'current_snapshots', (select count(*) from public.blog_public_snapshots where is_current),
      'missing_snapshot_slugs', coalesce((select json_agg(v.slug order by v.slug) from public.public_blog_content_creatives v where not exists (select 1 from public.blog_public_snapshots s where s.is_current and s.slug = v.slug)), '[]'::json),
      'review_blocked_published', (select count(*) from public.content_creatives c where c.channel = 'naver_blog' and c.status = 'published' and c.slug is not null and coalesce(c.review_status, '') in ('pending_review','in_review','rejected','changes_requested')),
      'review_blocked_with_disposition', (select count(*) from public.content_creatives c where c.channel = 'naver_blog' and c.status = 'published' and c.slug is not null and coalesce(c.review_status, '') in ('pending_review','in_review','rejected','changes_requested') and exists (select 1 from public.blog_url_dispositions d where d.creative_id = c.id and d.action in ('REDIRECT','QUARANTINE'))),
      'queued_without_verified_demand', (select count(*) from public.blog_topic_queue q where q.status = 'queued' and coalesce(q.monthly_search_volume, 0) <= 0 and coalesce(q.trend_score, 0) <= 0 and q.product_id is null and coalesce(q.meta ->> 'gsc_signal', '') <> 'true' and coalesce(q.meta ->> 'naver_signal', '') <> 'true' and nullif(q.meta ->> 'verified_operator_note_id', '') is null and coalesce(q.meta ->> 'editor_approved_seed', '') <> 'true' and coalesce(q.meta ->> 'active_product_relation_verified', '') <> 'true' and coalesce(q.meta ->> 'customer_question_count', '0') !~ '^[1-9][0-9]*$' and not exists (select 1 from public.blog_demand_signals d where d.queue_id = q.id and d.source_reference is not null and (d.expires_at is null or d.expires_at > now()) and (coalesce(d.signal_value, 0) > 0 or (d.provider in ('operator_note','editor_seed') and d.verified_at is not null) or d.provider = 'active_product_question'))),
      'due_queued_without_verified_demand', (select count(*) from public.blog_topic_queue q where q.status = 'queued' and (q.target_publish_at is null or q.target_publish_at <= now()) and coalesce(q.monthly_search_volume, 0) <= 0 and coalesce(q.trend_score, 0) <= 0 and q.product_id is null and coalesce(q.meta ->> 'gsc_signal', '') <> 'true' and coalesce(q.meta ->> 'naver_signal', '') <> 'true' and nullif(q.meta ->> 'verified_operator_note_id', '') is null and coalesce(q.meta ->> 'editor_approved_seed', '') <> 'true' and coalesce(q.meta ->> 'active_product_relation_verified', '') <> 'true' and coalesce(q.meta ->> 'customer_question_count', '0') !~ '^[1-9][0-9]*$' and not exists (select 1 from public.blog_demand_signals d where d.queue_id = q.id and d.source_reference is not null and (d.expires_at is null or d.expires_at > now()) and (coalesce(d.signal_value, 0) > 0 or (d.provider in ('operator_note','editor_seed') and d.verified_at is not null) or d.provider = 'active_product_question'))),
      'sample_slug', (select slug from public.public_blog_content_creatives where slug is not null order by published_at desc nulls last limit 1),
      'gsc_rows_90d', (select count(*) from public.blog_search_performance where provider = 'google_search_console' and metric_date >= current_date - 90),
      'gsc_latest_metric_date', (select max(metric_date)::text from public.blog_search_performance where provider = 'google_search_console'),
      'engagement_rows_7d', (select count(*) from public.blog_engagement_logs where created_at >= now() - interval '7 days'),
      'rum_rows_7d', (select count(*) from public.web_vitals where created_at >= now() - interval '7 days'),
      'analytics_canary_passed_at', (select max(occurred_at)::text from public.analytics_server_events where event_payload ->> '__synthetic' = 'true'),
      'natural_attributed_events_30d', (select count(*) from public.analytics_server_events where occurred_at >= now() - interval '30 days' and assisting_content_creative_id is not null and coalesce(event_payload ->> '__synthetic', 'false') <> 'true'),
      'outbox_dead', (select count(*) from public.analytics_server_event_outbox where status = 'dead')
    ) as evidence
  `);

  const rollout = presentCapabilities.includes('rollout_state_store')
    ? runLinkedReadOnlyQuery<{ stage: BlogProductionReadinessInputV4['rollout']['stage']; frozen: boolean; hard_incident_count: number }>(`
        select coalesce((select json_build_object('stage', stage, 'frozen', status = 'frozen', 'hard_incident_count', case when status = 'frozen' then 1 else 0 end) from public.blog_publication_rollout_state where scope = 'global' limit 1), json_build_object('stage', null, 'frozen', true, 'hard_incident_count', 0)) as evidence
      `)
    : { stage: null, frozen: true, hard_incident_count: 0 };
  const base = (argument('base') || 'https://www.yeosonam.com').replace(/\/$/, '');
  const unavailable = /BLOG_DATABASE_UNAVAILABLE|블로그 데이터를 (?:잠시 )?불러오지 못했습니다|블로그 데이터를 불러올 수 없습니다/i;
  const detailUrl = corpus.sample_slug ? `${base}/blog/${encodeURIComponent(corpus.sample_slug)}` : `${base}/blog/__missing_sample__`;
  const surfaceFailures = (await Promise.all([
    checkSurface(`${base}/blog`, (body, type) => !type.includes('text/html') ? 'unexpected_content_type' : unavailable.test(body) ? 'database_unavailable_visible' : !body.includes('/blog/') ? 'article_links_missing' : null),
    checkSurface(detailUrl, (body, type) => !corpus.sample_slug ? 'sample_slug_missing' : !type.includes('text/html') ? 'unexpected_content_type' : unavailable.test(body) ? 'database_unavailable_visible' : !body.includes('rel="canonical"') ? 'canonical_missing' : null),
    checkSurface(`${base}/sitemap.xml`, (body, type) => !type.includes('xml') || !/<(?:urlset|sitemapindex)\b/i.test(body) ? 'invalid_sitemap' : !body.includes('/blog/') ? 'blog_urls_missing' : null),
    checkSurface(`${base}/api/rss`, (body, type) => !type.includes('xml') || !/<rss\b/i.test(body) || !/<item>/i.test(body) ? 'invalid_rss' : null),
    checkSurface(`${base}/blog/image-sitemap.xml`, (body, type) => !type.includes('xml') || !/<urlset\b/i.test(body) ? 'invalid_image_sitemap' : null),
    checkSurface(`${base}/blog/__blog_v4_missing_probe__`, () => null, 404),
    ...[
      'blog-generate',
      'blog-publication-controller',
      'blog-ai-model-canary',
      'blog-analytics-canary',
    ].map((route) => checkSurface(
      `${base}/api/cron/${route}`,
      (body, type) => !type.includes('application/json') || !/unauthorized|인증/i.test(body)
        ? `v4_cron_route_contract_missing:${route}`
        : null,
      401,
    )),
  ])).filter((value): value is string => Boolean(value));

  const input: BlogProductionReadinessInputV4 = {
    source: {
      expectedBranch: argument('expected-branch') || 'main',
      productionBranch: argument('production-branch'),
      expectedCommitSha: argument('expected-commit') || '',
      productionCommitSha: argument('production-commit'),
    },
    release: {
      requiredForwardMigrations: requiredMigrations,
      presentMigrations: inventory.present_migrations || [],
      requiredCapabilities,
      presentCapabilities,
    },
    delivery: {
      publicEligible: corpus.public_eligible,
      currentSnapshots: corpus.current_snapshots,
      missingSnapshotSlugs: corpus.missing_snapshot_slugs,
      publicSurfaceFailures: surfaceFailures,
      databaseUnavailableErrorsSinceCandidateDeploy: numberArgument('database-errors-since-candidate'),
    },
    corpus: {
      reviewBlockedPublished: corpus.review_blocked_published,
      reviewBlockedWithDisposition: corpus.review_blocked_with_disposition,
      queuedWithoutVerifiedDemand: corpus.queued_without_verified_demand,
      dueQueuedWithoutVerifiedDemand: corpus.due_queued_without_verified_demand,
    },
    measurement: {
      schemaReady: ['search_performance', 'analytics_attribution', 'engagement_and_rum'].every((key) => presentCapabilities.includes(key)),
      gscRows90d: corpus.gsc_rows_90d,
      gscLatestMetricDate: corpus.gsc_latest_metric_date,
      engagementRows7d: corpus.engagement_rows_7d,
      rumRows7d: corpus.rum_rows_7d,
      analyticsCanaryPassedAt: corpus.analytics_canary_passed_at,
      naturalAttributedEvents30d: corpus.natural_attributed_events_30d,
      outboxDead: corpus.outbox_dead,
    },
    rollout: {
      stateStoreReady: presentCapabilities.includes('rollout_state_store') && rollout.stage != null,
      stage: rollout.stage,
      frozen: Boolean(rollout.frozen),
      dailyAiBudgetUsd: Number(argument('daily-ai-budget-usd') || process.env.BLOG_DAILY_AI_COST_CAP_USD || 0) || null,
      hardIncidentCount: Number(rollout.hard_incident_count || 0),
    },
  };
  const output = { version: 'blog-production-evidence-v4', readOnly: true, collectedAt: new Date().toISOString(), base, input };
  const outputPath = resolve(argument('output') || 'docs/audits/blog-production-evidence-v4-latest.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output: outputPath, input }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`blog production evidence collection failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
