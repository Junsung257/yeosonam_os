import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildCorpusAuditV3, getReadOnlySupabaseV3, loadCorpusRowsV3 } from './lib/blog-corpus-v3';

async function main(): Promise<void> {
  if (process.argv.includes('--apply')) throw new Error('audit-blog-corpus-v3 is permanently read-only');

  const client = getReadOnlySupabaseV3();
  const rows = await loadCorpusRowsV3(client);
  const audit = buildCorpusAuditV3(rows);
  const results = await Promise.all([
    client.from('public_blog_content_creatives').select('id', { count: 'exact', head: true }),
    client.from('blog_topic_queue').select('id, topic, destination, source, status, monthly_search_volume, trend_score, product_id, meta').in('status', ['queued', 'generating', 'pending_review']).order('target_publish_at'),
    client.from('blog_search_metrics').select('id', { count: 'exact', head: true }),
    client.from('analytics_server_events').select('id', { count: 'exact', head: true }),
    client.from('rank_history').select('id', { count: 'exact', head: true }),
    client.from('web_vitals').select('name, value, created_at').gte('created_at', '2026-05-13T00:00:00+09:00').limit(100000),
  ]);
  for (const result of results) if (result.error) throw new Error(`baseline_read_failed:${result.error.message}`);

  const publicCount = results[0].count || 0;
  const queueRows = results[1].data || [];
  const vitalRows = results[5].data || [];
  const percentile = (values: number[], p: number) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  };
  const vitals = Object.fromEntries(['LCP', 'INP', 'CLS', 'TTFB'].map((name) => {
    const values = vitalRows.filter((row) => row.name === name).map((row) => Number(row.value)).filter(Number.isFinite);
    return [name, { count: values.length, p75: percentile(values, 0.75) }];
  }));

  const enriched = {
    baseline_date: '2026-08-11', timezone: 'Asia/Seoul', read_only: true,
    source_of_truth: {
      branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      origin_main: execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim(),
      production_commit: '2ab65ef05b4a0f9fff8564a9685de0047bc08860',
      package_lock: 'package-lock.json', next_version: '15.5.21',
    },
    ...audit,
    public_eligible_count_current_view: publicCount,
    queued_topics: queueRows,
    queued_count: queueRows.length,
    queued_missing_monthly_search_volume_rate: queueRows.length ? queueRows.filter((row) => row.monthly_search_volume == null).length / queueRows.length : 0,
    queued_missing_trend_score_rate: queueRows.length ? queueRows.filter((row) => row.trend_score == null).length / queueRows.length : 0,
    measurement: {
      blog_search_metrics: results[2].count || 0,
      rank_history: results[4].count || 0,
      analytics_server_events: results[3].count || 0,
      field_vitals_90d: vitals,
      targets: { LCP_p75_ms: 2500, INP_p75_ms: 200, CLS_p75: 0.1 },
    },
    historical_documents: {
      yeosonam_os_blog_seo_audit_2026_07_15: 'not_found_after_rg_files_search',
      yeosonam_info_engine_v2_goal_master_2026_07_15: 'not_found_after_rg_files_search',
    },
    commands: {
      source_truth: ['git status --short --branch', 'git rev-parse HEAD', 'git rev-parse origin/main', 'git diff --stat origin/main...HEAD', 'node -p "require(\'./package.json\').dependencies.next"'],
      run_audit: 'npx tsx scripts/audit-blog-corpus-v3.ts',
      sql: {
        published: "select count(*) from content_creatives where channel='naver_blog' and status='published' and slug is not null;",
        public: 'select count(*) from public_blog_content_creatives;',
        reviews: "select coalesce(review_status,'null'), count(*) from content_creatives where channel='naver_blog' and status='published' and slug is not null group by 1;",
        queue: "select topic,destination,source,status,monthly_search_volume,trend_score,product_id,meta from blog_topic_queue where status in ('queued','generating','pending_review');",
        measurement: 'select (select count(*) from rank_history), (select count(*) from blog_search_metrics), (select count(*) from analytics_server_events);',
      },
    },
    prior_audit_reference: {
      note: 'Mission-provided values are retained because the V3 normalizer and current corpus can differ from the earlier audit.',
      published: 200, public_eligible: 192, exact_duplicate_groups: 16, exact_duplicate_articles: 34,
      normalized_skeleton_groups: 16, normalized_skeleton_articles: 148,
      image_occurrences: 596, pexels_occurrences: 582, queued_at_audit: 11,
    },
  };

  mkdirSync('docs/audits', { recursive: true });
  writeFileSync('docs/audits/blog-quality-engine-v3-baseline-2026-08-11.json', `${JSON.stringify(enriched, null, 2)}\n`);
  const exact = audit.exact_title_duplicates as Array<{ count: number }>;
  const skeleton = audit.normalized_title_skeleton_duplicates as Array<{ count: number }>;
  const markdown = `# Blog Quality Engine V3 baseline — 2026-08-11

기준 시간대는 Asia/Seoul입니다. 운영 Supabase에는 SELECT만 실행했고 migration, UPDATE, DELETE는 실행하지 않았습니다.

## Source of truth

- 작업 기준: \`origin/main\` = production commit \`2ab65ef05b4a0f9fff8564a9685de0047bc08860\`
- 격리 branch: \`${enriched.source_of_truth.branch}\`
- lockfile: \`package-lock.json\`, Next.js \`15.5.21\`
- 운영 배포가 feature branch commit을 직접 사용한 이력이 있어, main 병합 후 immutable commit을 promote하고 branch-name deploy를 금지하는 runbook 절차가 필요합니다.

## 현재 재계산

- 발행 ${audit.corpus.published}, 정보성 ${audit.corpus.informational}, 상품 연결 ${audit.corpus.product_linked}
- 현재 SQL view 공개 가능 ${publicCount}
- exact duplicate title ${exact.length} groups / ${exact.reduce((sum, group) => sum + group.count, 0)} rows
- V3 normalized title skeleton(3+) ${skeleton.length} groups / ${skeleton.reduce((sum, group) => sum + group.count, 0)} rows
- SEO 평균 ${audit.quality.seo_average}, 95 이상 ${audit.quality.seo_95_or_more}, readability 100 ${audit.quality.readability_100}
- queue ${queueRows.length}, 검색량 null ${queueRows.filter((row) => row.monthly_search_volume == null).length}, trend null ${queueRows.filter((row) => row.trend_score == null).length}
- 측정 row: rank_history ${results[4].count || 0}, blog_search_metrics ${results[2].count || 0}, analytics_server_events ${results[3].count || 0}
- field p75: LCP ${vitals.LCP.p75 ?? '없음'}ms, INP ${vitals.INP.p75 ?? '없음'}ms, CLS ${vitals.CLS.p75 ?? '없음'} (표본은 JSON 참조)

## 감사 버전 차이

미션 입력 감사의 기준값(제목 골격 16/148, 이미지 596회 중 Pexels 582회, queued 11)은 JSON에 보존했습니다. 현재 DB 시점과 V3 parser 결과는 별도 필드이며 과거 수치를 덮어쓰지 않습니다.

## 재현 명령과 SQL

\`npx tsx scripts/audit-blog-corpus-v3.ts\`

\`select count(*) from content_creatives where channel='naver_blog' and status='published' and slug is not null;\`

\`select count(*) from public_blog_content_creatives;\`

\`select coalesce(review_status,'null'), count(*) from content_creatives where channel='naver_blog' and status='published' and slug is not null group by 1;\`

모든 signature, URL, image host와 큐 row는 동명의 JSON에 있습니다.

## 과거 문서 검색

- \`yeosonam_os_blog_seo_audit_2026-07-15.md\`: 없음 (\`rg --files\` 검색)
- \`yeosonam_info_engine_v2_goal_master_2026-07-15.md\`: 없음 (\`rg --files\` 검색)
`;
  writeFileSync('docs/audits/blog-quality-engine-v3-baseline-2026-08-11.md', markdown);
  console.log(JSON.stringify({ ok: true, published: audit.corpus.published, public: publicCount, queued: queueRows.length }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
