import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { evaluateBlogDataReadinessV3 } from '../src/lib/blog-data-readiness-v3';
import { evaluateBlogProductionReadinessV3, type BlogPublicSurfaceReadinessV3 } from '../src/lib/blog-production-readiness-v3';
import {
  BLOG_RUNTIME_RESOURCES_V3,
  probeBlogRuntimeSchemaReadinessV3,
} from '../src/lib/blog-runtime-readiness-v3';

const EXPECTED_MIGRATIONS = [
  '20260606115000',
  '20260811132017',
  '20260811132023',
  '20260811132031',
  '20260811132037',
  '20260811210920',
  '20260814001600',
  '20260814011000',
  '20260814012500',
  '20260814033000',
  '20260815093943',
] as const;

interface SchemaInventoryRow {
  table_name: string;
  column_name: string;
}

interface SchemaInventory {
  columns: SchemaInventoryRow[];
  present_migrations: string[];
  latest_remote_version: string | null;
}

interface CorpusInventory {
  published: number;
  public_eligible: number;
  review_blocked_published: number;
  queued_without_demand: number;
  sample_slug: string | null;
  web_vitals_7d: number;
  blog_engagement_7d: number;
  analytics_server_events_30d: number;
  rank_history_30d: number;
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runLinkedReadOnlyQuery<T>(sql: string): T {
  // Supabase CLI's Windows positional parser truncates multiline query
  // arguments. These verifier statements contain no whitespace-sensitive
  // string literals, so normalize them to one line before invoking the CLI.
  const statement = sql.trim().replace(/\s+/g, ' ');
  if (/\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|call)\b/i.test(statement)) {
    throw new Error('readiness verifier accepts SELECT statements only');
  }
  const commandOptions: {
    encoding: 'utf8';
    maxBuffer: number;
    stdio: ['ignore', 'pipe', 'pipe'];
  } = {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const stdout = process.platform === 'win32'
    ? execFileSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$query = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(statement, 'utf8').toString('base64')}')); $nodeExe = (Get-Command node).Source; $npxCli = Join-Path (Split-Path $nodeExe) 'node_modules\\npm\\bin\\npx-cli.js'; & $nodeExe $npxCli supabase db query --linked --output json $query`,
      ], commandOptions)
    : execFileSync(
        'npx',
        ['supabase', 'db', 'query', '--linked', '--output', 'json', statement],
        commandOptions,
      );
  const parsed = JSON.parse(stdout) as { rows?: Array<{ readiness?: T }> };
  const value = parsed.rows?.[0]?.readiness;
  if (value == null) throw new Error('linked query returned no readiness payload');
  return value;
}

async function fetchSurface(
  key: BlogPublicSurfaceReadinessV3['key'],
  url: string,
  validate: (body: string, contentType: string) => string | null,
): Promise<BlogPublicSurfaceReadinessV3> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'YeosonamBlogProductionReadinessV3/1.0' },
    });
    const body = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const contentFailure = validate(body, contentType);
    const reason = !response.ok
      ? `http_${response.status}`
      : contentFailure ?? 'passed';
    return { key, url, passed: response.ok && contentFailure == null, statusCode: response.status, reason };
  } catch (error) {
    return {
      key,
      url,
      passed: false,
      statusCode: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function tableIsReady(schema: Awaited<ReturnType<typeof probeBlogRuntimeSchemaReadinessV3>>, key: string): boolean {
  return schema.checks.find((check) => check.key === key)?.ready === true;
}

function countIfReady(
  ready: boolean,
  sql: string,
): number | null {
  if (!ready) return null;
  return Number(runLinkedReadOnlyQuery<number>(sql));
}

async function main(): Promise<void> {
  if (process.argv.includes('--apply')) throw new Error('production readiness verification is permanently read-only');

  const base = (argument('base') || 'https://www.yeosonam.com').replace(/\/$/, '');
  const expectedBranch = argument('expected-branch') || 'main';
  const productionBranch = argument('production-branch') || process.env.VERCEL_GIT_COMMIT_REF || null;
  const productionCommitSha = argument('production-commit') || process.env.VERCEL_GIT_COMMIT_SHA || null;
  const runtimeErrorsArg = argument('database-errors-7d');
  const databaseUnavailableErrors7d = runtimeErrorsArg != null && /^\d+$/.test(runtimeErrorsArg)
    ? Number(runtimeErrorsArg)
    : null;
  const tableNames = [...new Set(BLOG_RUNTIME_RESOURCES_V3.map((resource) => resource.table))];
  const inventory = runLinkedReadOnlyQuery<SchemaInventory>(`
    select json_build_object(
      'columns', coalesce((
        select json_agg(json_build_object('table_name', c.table_name, 'column_name', c.column_name))
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = any(array[${tableNames.map(sqlLiteral).join(',')}])
      ), '[]'::json),
      'present_migrations', coalesce((
        select json_agg(m.version order by m.version)
        from supabase_migrations.schema_migrations m
        where m.version = any(array[${EXPECTED_MIGRATIONS.map(sqlLiteral).join(',')}])
      ), '[]'::json),
      'latest_remote_version', (
        select max(m.version) from supabase_migrations.schema_migrations m
      )
    ) as readiness
  `);
  const availableColumns = new Map<string, Set<string>>();
  for (const row of inventory.columns ?? []) {
    const columns = availableColumns.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    availableColumns.set(row.table_name, columns);
  }
  const schema = await probeBlogRuntimeSchemaReadinessV3(async (resource) => {
    const available = availableColumns.get(resource.table);
    const required = resource.columns.split(',').map((column) => column.trim());
    const missing = required.filter((column) => !available?.has(column));
    return missing.length === 0
      ? { error: null }
      : { error: { code: 'schema_inventory_missing', message: missing.join(',') } };
  });

  const corpus = runLinkedReadOnlyQuery<CorpusInventory>(`
    select json_build_object(
      'published', (
        select count(*) from public.content_creatives
        where channel = 'naver_blog' and status = 'published' and slug is not null
      ),
      'public_eligible', (select count(*) from public.public_blog_content_creatives),
      'review_blocked_published', (
        select count(*) from public.content_creatives
        where channel = 'naver_blog' and status = 'published' and slug is not null
          and coalesce(review_status, '') in ('pending_review','in_review','rejected','changes_requested')
      ),
      'queued_without_demand', (
        select count(*) from public.blog_topic_queue q
        where q.status = 'queued'
          and coalesce(q.monthly_search_volume, 0) <= 0
          and coalesce(q.trend_score, 0) <= 0
          and q.product_id is null
          and coalesce(q.meta ->> 'gsc_signal', '') <> 'true'
          and coalesce(q.meta ->> 'naver_signal', '') <> 'true'
          and nullif(q.meta ->> 'verified_operator_note_id', '') is null
          and coalesce(q.meta ->> 'editor_approved_seed', '') <> 'true'
          and coalesce(q.meta ->> 'customer_question_count', '0') !~ '^[1-9][0-9]*$'
      ),
      'sample_slug', (
        select slug from public.public_blog_content_creatives
        where slug is not null order by published_at desc nulls last limit 1
      ),
      'web_vitals_7d', (select count(*) from public.web_vitals where created_at >= now() - interval '7 days'),
      'blog_engagement_7d', (select count(*) from public.blog_engagement_logs where created_at >= now() - interval '7 days'),
      'analytics_server_events_30d', (select count(*) from public.analytics_server_events where occurred_at >= now() - interval '30 days'),
      'rank_history_30d', (select count(*) from public.rank_history where date >= current_date - 30)
    ) as readiness
  `);

  const now = new Date();
  const isoDaysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const currentSnapshots = countIfReady(
    tableIsReady(schema, 'public_snapshots'),
    "select count(*)::integer as readiness from public.blog_public_snapshots where is_current",
  );
  const data = evaluateBlogDataReadinessV3({
    searchPerformance30d: countIfReady(
      tableIsReady(schema, 'search_performance'),
      `select count(*)::integer as readiness from public.blog_search_performance where metric_date >= ${sqlLiteral(isoDaysAgo(30).slice(0, 10))}`,
    ),
    engagement7d: countIfReady(
      tableIsReady(schema, 'engagement_dimensions'),
      `select count(*)::integer as readiness from public.blog_engagement_logs where created_at >= ${sqlLiteral(isoDaysAgo(7))}::timestamptz`,
    ),
    serverEvents30d: countIfReady(
      tableIsReady(schema, 'server_event_attribution'),
      `select count(*)::integer as readiness from public.analytics_server_events where occurred_at >= ${sqlLiteral(isoDaysAgo(30))}::timestamptz`,
    ),
    rum7d: countIfReady(
      tableIsReady(schema, 'rum_dimensions'),
      `select count(*)::integer as readiness from public.web_vitals where created_at >= ${sqlLiteral(isoDaysAgo(7))}::timestamptz`,
    ),
    currentSnapshots,
    outboxDead: countIfReady(
      tableIsReady(schema, 'analytics_outbox'),
      "select count(*)::integer as readiness from public.analytics_server_event_outbox where status = 'dead'",
    ),
    outboxReady: countIfReady(
      tableIsReady(schema, 'analytics_outbox'),
      "select count(*)::integer as readiness from public.analytics_server_event_outbox where status in ('pending','failed','processing')",
    ),
  }, now);

  const unavailablePattern = /BLOG_DATABASE_UNAVAILABLE|블로그 데이터를 (?:잠시 )?불러오지 못했습니다|블로그 데이터를 불러올 수 없습니다/i;
  const detailUrl = corpus.sample_slug ? `${base}/blog/${encodeURIComponent(corpus.sample_slug)}` : `${base}/blog/__missing_sample__`;
  const surfaces = await Promise.all([
    fetchSurface('catalog', `${base}/blog`, (body, contentType) => (
      !contentType.includes('text/html') ? 'unexpected_content_type'
        : unavailablePattern.test(body) ? 'database_unavailable_surface_visible'
          : !body.includes('/blog/') ? 'article_links_missing' : null
    )),
    fetchSurface('sitemap', `${base}/sitemap.xml`, (body, contentType) => (
      !contentType.includes('xml') ? 'unexpected_content_type'
        : !/<(?:urlset|sitemapindex)\b/i.test(body) ? 'invalid_sitemap_xml'
          : !body.includes('/blog/') ? 'blog_urls_missing' : null
    )),
    fetchSurface('rss', `${base}/api/rss`, (body, contentType) => (
      !contentType.includes('rss+xml') && !contentType.includes('xml') ? 'unexpected_content_type'
        : !/<rss\b/i.test(body) || !/<item>/i.test(body) ? 'rss_items_missing' : null
    )),
    fetchSurface('image_sitemap', `${base}/blog/image-sitemap.xml`, (body, contentType) => (
      !contentType.includes('xml') ? 'unexpected_content_type'
        : !/<urlset\b/i.test(body) || !/<image:image>/i.test(body) ? 'image_entries_missing' : null
    )),
    fetchSurface('detail', detailUrl, (body, contentType) => (
      !corpus.sample_slug ? 'sample_slug_missing'
        : !contentType.includes('text/html') ? 'unexpected_content_type'
          : unavailablePattern.test(body) ? 'database_unavailable_surface_visible'
            : !body.includes(`<link rel="canonical" href="${detailUrl}"`) ? 'canonical_missing_or_mismatched' : null
    )),
  ]);

  const report = evaluateBlogProductionReadinessV3({
    schema,
    data,
    source: { expectedBranch, productionBranch, productionCommitSha },
    migrations: {
      expected: [...EXPECTED_MIGRATIONS],
      present: inventory.present_migrations ?? [],
      latestRemoteVersion: inventory.latest_remote_version ?? null,
    },
    corpus: {
      published: corpus.published,
      publicEligible: corpus.public_eligible,
      currentSnapshots,
      reviewBlockedPublished: corpus.review_blocked_published,
      queuedWithoutDemand: corpus.queued_without_demand,
    },
    runtime: { databaseUnavailableErrors7d },
    surfaces,
  }, now);

  const output = { readOnly: true, base, schema, data, corpus, surfaces, report };
  const outputPath = argument('output');
  if (outputPath) {
    const absoluteOutputPath = resolve(outputPath);
    mkdirSync(dirname(absoluteOutputPath), { recursive: true });
    writeFileSync(absoluteOutputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write([
      `Blog Production Readiness V3: ${report.safeToEnableLive ? 'PASS' : 'BLOCKED'}`,
      `delivery=${report.deliveryReady} measurement=${report.measurementReady} corpus=${report.corpusReady}`,
      ...report.checks.map((check) => `${check.status.toUpperCase()} ${check.key}: ${check.reason}`),
    ].join('\n') + '\n');
  }
  if (process.argv.includes('--strict') && !report.safeToEnableLive) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`blog production readiness failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
