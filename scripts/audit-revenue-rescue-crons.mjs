import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

const essentialRevenue = new Set([
  'refresh-registration-mv',
  'booking-tasks-runner',
  'payment-stale-alert',
  'ledger-reconcile',
  'booking-attribution-audit',
  'snapshot-inventory',
  'sync-flight-availability',
  'affiliate-settlement-draft',
]);

const essentialSecurity = new Set([
  'agent-housekeeping',
  'affiliate-anomaly-detect',
  'hard-block-alert',
  'magic-tokens-cleanup',
  'fraud-detect',
  'content-drift-detect',
]);

const pause = new Set([
  'meta-optimize',
  'post-travel',
  'post-travel-reels',
  'ad-optimizer',
  'ad-os-keyword-growth',
  'ad-os-safe-pipelines',
  'auto-archive',
  'unmatched-orchestrator',
  'legacy-sections-backfill',
  'fill-attraction-photos',
  'agent-executor',
  'embed-products',
  'blog-lifecycle',
  'blog-scheduler',
  'publish-scheduled',
  'auto-publish-loop',
  'blog-publisher',
  'blog-regenerate-zero-click',
  'dlq-replay',
  'variant-winner-decide',
  'free-travel-retarget',
  'concierge-cart-retarget',
  'dynamic-pricing',
  'weather-upsell',
  'band-rss',
  'solapi-review-request',
  'programmatic-seo-generator',
  'blog-orchestrator',
]);

function cronName(routePath) {
  return routePath.split('/').filter(Boolean).at(-1);
}

function ownerFor(name) {
  if (/blog|seo|rank|gsc|content|threads|ig-|band|creative|marketing|meta|ad-|variant/.test(name)) {
    return 'marketing/content';
  }
  if (/affiliate/.test(name)) return 'affiliate';
  if (/booking|payment|ledger|settlement|revenue/.test(name)) return 'revenue-ops';
  if (/agent|rag|learning|scoring|conformal/.test(name)) return 'ai-ops';
  if (/product|package|inventory|flight|destination|attraction|seasonal/.test(name)) return 'product-ops';
  return 'platform-ops';
}

function decisionFor(name) {
  if (essentialRevenue.has(name)) return 'ESSENTIAL_REVENUE';
  if (essentialSecurity.has(name)) return 'ESSENTIAL_SECURITY';
  if (pause.has(name)) return 'PAUSE';
  return 'OBSERVE_ONLY';
}

function routeAnalysis(routePath) {
  const file = path.join(root, 'src', 'app', ...routePath.split('/').filter(Boolean), 'route.ts');
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const tables = [
    ...source.matchAll(/\.from\(\s*['"`]([A-Za-z0-9_]+)['"`]\s*\)/g),
  ].map((match) => match[1]);
  const reads = [...new Set(tables)].sort();
  const writes = [...new Set(
    [...source.matchAll(
      /\.from\(\s*['"`]([A-Za-z0-9_]+)['"`]\s*\)[\s\S]{0,240}?\.(?:insert|upsert|update|delete)\s*\(/g
    )].map((match) => match[1])
  )].sort();
  const externalMutation = [
    /graph\.facebook\.com/i,
    /publishInstagram|publishTo|sendKakao|sendSms|sendEmail/i,
    /createMetaCampaign|uploadCreativeToMeta|createAdSet|createAd\(/i,
    /external[_-]?(?:api[_-]?)?(?:write|mutation)/i,
  ].some((pattern) => pattern.test(source));
  return {
    file: fs.existsSync(file) ? path.relative(root, file).replaceAll('\\', '/') : null,
    reads,
    writes,
    externalMutation,
  };
}

const cronHealth = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      'docs',
      'audits',
      '20260729-revenue-rescue',
      'outputs',
      'cron-health.json'
    ),
    'utf8'
  )
);
const logs = cronHealth.byCron;
const inventory = vercel.crons.map((cron) => {
  const name = cronName(cron.path);
  const analysis = routeAnalysis(cron.path);
  const matching = logs.filter((log) => log.cron_name === name);
  const health = matching[0];
  const decision = decisionFor(name);
  return {
    route: cron.path,
    schedule: cron.schedule,
    owner: ownerFor(name),
    routeFile: analysis.file,
    tableReads: analysis.reads,
    tableWrites: analysis.writes,
    externalMutations: analysis.externalMutation ? 'possible_static_match' : 'none_found_in_route',
    lastSuccessfulRun: health?.last_success ?? null,
    lastFailure: health?.last_non_success ?? null,
    revenueDependency: decision === 'ESSENTIAL_REVENUE' ? 'direct_or_required' : 'not_proven_for_p0',
    decision,
    rollbackMethod:
      decision === 'PAUSE'
        ? 'Restore the exact vercel.json schedule entry and revert the central capability override.'
        : 'Revert the classification/policy commit; no route deletion is planned.',
  };
});

const outputDir = path.join(root, 'docs', 'audits', '20260729-revenue-rescue');
fs.writeFileSync(
  path.join(outputDir, 'outputs', 'cron-inventory.json'),
  `${JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      repositorySha: 'eb582cabd6d16b98bd26ca8fca8ddc740fb80845',
      projectRef: 'ixaxnvbmhzjvupissmly',
      scheduleCount: inventory.length,
      limitations: [
        'Table access is a static route-file scan and can miss calls hidden behind imported helpers.',
        'External mutation is confirmed only after route-to-provider trace review.',
        'No schedule or external system was mutated by this inventory.',
      ],
      inventory,
    },
    null,
    2
  )}\n`
);

const esc = (value) => String(value ?? '—').replaceAll('|', '\\|').replace(/\s+/g, ' ');
const lines = [
  '# Cron Classification',
  '',
  `Observed schedules: ${inventory.length}. P0 classification is conservative: revenue/security essentials remain scheduled; unproven external or autonomous mutation is a pause candidate; analytical work is observe-only.`,
  '',
  '| Route | Schedule | Owner | Table reads | Table writes | External mutations | Last successful run | Last failure | Revenue dependency | Decision | Rollback method |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...inventory.map((row) =>
    [
      row.route,
      `\`${row.schedule}\``,
      row.owner,
      row.tableReads.join(', ') || 'none found',
      row.tableWrites.join(', ') || 'none found',
      row.externalMutations,
      row.lastSuccessfulRun,
      row.lastFailure,
      row.revenueDependency,
      row.decision,
      row.rollbackMethod,
    ]
      .map(esc)
      .join(' | ')
      .replace(/^/, '| ')
      .replace(/$/, ' |')
  ),
  '',
  '## Interpretation limits',
  '',
  '- “none found” means the direct route file did not contain a matching call; imported helpers still require trace review.',
  '- `PAUSE` is a classification, not a production mutation. PR 1 removes no schedules and changes no route behavior.',
  '- Route code is retained. Later pause implementation must use schedule removal or a central capability gate with an explicit rollback.',
  '',
];
fs.writeFileSync(path.join(outputDir, 'cron-classification.md'), lines.join('\n'));

console.log(
  JSON.stringify({
    scheduleCount: inventory.length,
    decisions: Object.fromEntries(
      [...new Set(inventory.map((row) => row.decision))].map((decision) => [
        decision,
        inventory.filter((row) => row.decision === decision).length,
      ])
    ),
  })
);
