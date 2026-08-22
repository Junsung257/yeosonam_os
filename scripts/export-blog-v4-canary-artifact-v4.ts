import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const MAX_WAIT_MS = 15 * 60 * 1000;
const POLL_MS = 15 * 1000;

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`blog_v4_canary_artifact_missing_argument:${name}`);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`blog_v4_canary_artifact_missing_env:${name}`);
  return value;
}

function db(): SupabaseClient {
  return createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeArticleHtml(value: unknown): string {
  return text(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readOperation(dbClient: SupabaseClient, operationId: string) {
  const result = await dbClient
    .from('blog_content_operations')
    .select('id,queue_id,status,current_stage,generation_run_id,creative_id,workflow_run_id,failure_code,skip_reason,updated_at')
    .eq('id', operationId)
    .maybeSingle();
  if (result.error) throw new Error(`blog_v4_canary_operation_read_failed:${result.error.message}`);
  return result.data as Record<string, unknown> | null;
}

async function readOperationDiagnostics(dbClient: SupabaseClient, operationId: string) {
  const operationResult = await dbClient
    .from('blog_content_operations')
    .select('id,queue_id,status,current_stage,fencing_token,lease_owner,lease_expires_at,workflow_run_id,generation_run_id,creative_id,failure_code,skip_reason,started_at,completed_at,updated_at')
    .eq('id', operationId)
    .maybeSingle();
  if (operationResult.error) throw new Error(`blog_v4_canary_operation_diagnostic_read_failed:${operationResult.error.message}`);
  const operation = operationResult.data as Record<string, unknown> | null;
  const queueId = text(operation?.queue_id);
  const generationRunId = text(operation?.generation_run_id);

  const eventsResult = await dbClient
    .from('blog_content_stage_events')
    .select('event_key,stage,status,failure_code,provider,model,attempt_number,estimated_cost_usd,evidence,occurred_at')
    .eq('operation_id', operationId)
    .order('occurred_at', { ascending: true });
  if (eventsResult.error) throw new Error(`blog_v4_canary_event_diagnostic_read_failed:${eventsResult.error.message}`);

  const runResult = generationRunId
    ? await dbClient
      .from('blog_generation_runs')
      .select('id,queue_id,status,selected_attempt_id,latest_quality_score,disposition,updated_at')
      .eq('id', generationRunId)
      .maybeSingle()
    : { data: null, error: null };
  if (runResult.error) throw new Error(`blog_v4_canary_run_diagnostic_read_failed:${runResult.error.message}`);

  const attemptsResult = generationRunId
    ? await dbClient
      .from('blog_generation_attempts')
      .select('id,attempt_number,stage,status,provider,model,estimated_cost_usd,error_code,created_at,completed_at')
      .eq('run_id', generationRunId)
      .order('attempt_number', { ascending: true })
    : { data: [], error: null };
  if (attemptsResult.error) throw new Error(`blog_v4_canary_attempt_diagnostic_read_failed:${attemptsResult.error.message}`);

  const budgetsResult = queueId
    ? await dbClient
      .from('blog_ai_budget_reservations')
      .select('id,budget_day_kst,queue_id,attempt_number,stage,provider,model,cap_usd,requested_usd,reserved_usd,actual_usd,status,receipt,settled_at,created_at,updated_at')
      .eq('queue_id', queueId)
      .order('created_at', { ascending: true })
    : { data: [], error: null };
  if (budgetsResult.error) throw new Error(`blog_v4_canary_budget_diagnostic_read_failed:${budgetsResult.error.message}`);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    operation,
    generationRun: runResult.data ?? null,
    stageEvents: eventsResult.data ?? [],
    generationAttempts: attemptsResult.data ?? [],
    aiBudgetReservations: budgetsResult.data ?? [],
  };
}

async function waitForOperation(dbClient: SupabaseClient, operationId: string) {
  const deadline = Date.now() + MAX_WAIT_MS;
  let operation: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    operation = await readOperation(dbClient, operationId);
    if (operation && ['human_review', 'approved_for_slot', 'quarantined', 'failed', 'cancelled', 'published', 'indexed'].includes(text(operation.status))) {
      return operation;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`blog_v4_canary_operation_timeout:${text(operation?.status || 'missing')}`);
}

async function readArtifacts(dbClient: SupabaseClient, operation: Record<string, unknown>) {
  const queueId = text(operation.queue_id);
  const operationId = text(operation.id);
  const runId = text(operation.generation_run_id) || null;

  const queueResult = await dbClient
    .from('blog_topic_queue')
    .select('id,topic,destination,primary_keyword,category,source,status,meta')
    .eq('id', queueId)
    .maybeSingle();
  if (queueResult.error) throw new Error(`blog_v4_canary_queue_read_failed:${queueResult.error.message}`);

  let run: Record<string, unknown> | null = null;
  if (runId) {
    const runResult = await dbClient
      .from('blog_generation_runs')
      .select('id,queue_id,content_creative_id,status,selected_attempt_id,latest_quality_score,disposition,updated_at')
      .eq('id', runId)
      .maybeSingle();
    if (runResult.error) throw new Error(`blog_v4_canary_run_read_failed:${runResult.error.message}`);
    run = runResult.data as Record<string, unknown> | null;
  }
  if (!run) {
    const runResult = await dbClient
      .from('blog_generation_runs')
      .select('id,queue_id,content_creative_id,status,selected_attempt_id,latest_quality_score,disposition,updated_at')
      .eq('queue_id', queueId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runResult.error) throw new Error(`blog_v4_canary_latest_run_read_failed:${runResult.error.message}`);
    run = runResult.data as Record<string, unknown> | null;
  }

  const creativeId = text(operation.creative_id) || text(run?.content_creative_id) || null;
  let creative: Record<string, unknown> | null = null;
  if (creativeId) {
    const creativeResult = await dbClient
      .from('content_creatives')
      .select('id,title,description,seo_title,seo_description,blog_html,slug,status,review_status,published_at,quality_gate,generation_meta,generation_params,source,topic_source,destination,category,angle_type')
      .eq('id', creativeId)
      .maybeSingle();
    if (creativeResult.error) throw new Error(`blog_v4_canary_creative_read_failed:${creativeResult.error.message}`);
    creative = creativeResult.data as Record<string, unknown> | null;
  }

  const attemptsResult = run?.id
    ? await dbClient
      .from('blog_generation_attempts')
      .select('attempt_number,stage,status,provider,model,input_tokens,cache_hit_input_tokens,output_tokens,estimated_cost_usd,quality_score_before,quality_score_after,route,hard_blockers,failure_reasons,output_document,completed_at')
      .eq('run_id', text(run.id))
      .order('attempt_number', { ascending: true })
    : { data: [], error: null };
  if (attemptsResult.error) throw new Error(`blog_v4_canary_attempt_read_failed:${attemptsResult.error.message}`);

  const eventsResult = await dbClient
    .from('blog_content_stage_events')
    .select('event_key,stage,status,failure_code,provider,model,attempt_number,estimated_cost_usd,evidence,occurred_at')
    .eq('operation_id', operationId)
    .order('occurred_at', { ascending: true });
  if (eventsResult.error) throw new Error(`blog_v4_canary_event_read_failed:${eventsResult.error.message}`);

  const claimsResult = creativeId
    ? await dbClient
      .from('blog_information_claim_ledger_v3')
      .select('claim_id,claim_text,claim_type,risk_level,source_url,source_domain,source_type,evidence_excerpt,verification_status,conflict_status,retrieved_at')
      .eq('creative_id', creativeId)
    : { data: [], error: null };
  if (claimsResult.error) throw new Error(`blog_v4_canary_claim_read_failed:${claimsResult.error.message}`);

  const indexingResult = creativeId
    ? await dbClient
      .from('blog_indexing_jobs')
      .select('id,status,url,source,type,created_at')
      .eq('content_creative_id', creativeId)
    : { data: [], error: null };
  if (indexingResult.error) throw new Error(`blog_v4_canary_indexing_read_failed:${indexingResult.error.message}`);

  const publicationResult = creativeId
    ? await dbClient
      .from('blog_publication_decisions')
      .select('id,decision,autopublish_mode,policy_version,decided_at')
      .eq('creative_id', creativeId)
    : { data: [], error: null };
  if (publicationResult.error) throw new Error(`blog_v4_canary_publication_read_failed:${publicationResult.error.message}`);

  const attempts = (attemptsResult.data ?? []) as Array<Record<string, unknown>>;
  const claims = (claimsResult.data ?? []) as Array<Record<string, unknown>>;
  const indexingJobs = (indexingResult.data ?? []) as Array<Record<string, unknown>>;
  const publicationDecisions = (publicationResult.data ?? []) as Array<Record<string, unknown>>;
  const generationMeta = asRecord(creative?.generation_meta);
  const qualityGate = asRecord(creative?.quality_gate);
  const outputDocument = asRecord((attempts.find((item) => item.status === 'completed') as Record<string, unknown> | undefined)?.output_document);
  const outputAudit = asRecord(outputDocument.audit);
  const sources = Array.isArray(outputAudit.sources) ? outputAudit.sources : [];
  const flashCalls = attempts.filter((item) => text(item.model).toLowerCase().includes('flash') && item.status === 'completed').length;
  const proCalls = attempts.filter((item) => text(item.model).toLowerCase().includes('pro') && item.status === 'completed').length;
  const aiCost = attempts.reduce((sum, item) => sum + Number(item.estimated_cost_usd ?? 0), 0);
  const publicationCount = Math.max(
    publicationDecisions.filter((item) => item.decision === 'published').length,
    creative && (text(creative.status) === 'published' || creative.published_at) ? 1 : 0,
  );
  const traceId = text(operation.workflow_run_id || generationMeta.traceId || generationMeta.trace_id || outputAudit.traceId || outputAudit.trace_id)
    || `blog-content-operation:${operationId}`;
  const body = text(creative?.blog_html) || text(outputDocument.markdown);
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    operationId,
    queueId,
    generationRunId: run?.id ?? null,
    candidateCount: 1,
    topic: queueResult.data?.topic ?? null,
    disposition: operation.status,
    status: operation.status,
    currentStage: operation.current_stage,
    title: creative?.title ?? outputDocument.title ?? null,
    metaDescription: creative?.seo_description ?? creative?.description ?? outputDocument.description ?? null,
    qualityScore: run?.latest_quality_score ?? qualityGate.score ?? null,
    qualityGate,
    hardBlockers: attempts.flatMap((item) => Array.isArray(item.hard_blockers) ? item.hard_blockers : []),
    failureReasons: attempts.flatMap((item) => Array.isArray(item.failure_reasons) ? item.failure_reasons : []),
    flashCalls,
    proCalls,
    aiCostUsd: Number(aiCost.toFixed(8)),
    bodyPresent: body.trim().length > 0,
    officialSourcesPresent: claims.length > 0 || sources.length > 0,
    claimCount: claims.length,
    claims,
    traceId,
    publicationCount,
    publicationDecisions,
    indexingSideEffects: indexingJobs.length,
    indexingJobs,
    attempts: attempts.map((item) => ({
      attemptNumber: item.attempt_number,
      stage: item.stage,
      provider: item.provider,
      model: item.model,
      status: item.status,
      route: item.route,
      inputTokens: item.input_tokens,
      cachedInputTokens: item.cache_hit_input_tokens,
      outputTokens: item.output_tokens,
      estimatedCostUsd: item.estimated_cost_usd,
      qualityScoreAfter: item.quality_score_after,
      completedAt: item.completed_at,
    })),
    stageEvents: eventsResult.data ?? [],
    failureCode: operation.failure_code ?? null,
    skipReason: operation.skip_reason ?? null,
    seedMetadata: asRecord(queueResult.data?.meta),
  };

  const passed = evidence.candidateCount === 1
    && evidence.flashCalls <= 1
    && evidence.proCalls <= 1
    && evidence.aiCostUsd <= 0.25
    && evidence.bodyPresent
    && evidence.officialSourcesPresent
    && Boolean(evidence.traceId)
    && evidence.publicationCount === 0
    && evidence.indexingSideEffects === 0;
  return { evidence: { ...evidence, passed }, body, passed };
}

function htmlDocument(artifact: Awaited<ReturnType<typeof readArtifacts>>): string {
  const { evidence, body } = artifact;
  const claims = Array.isArray(evidence.claims) ? evidence.claims as Array<Record<string, unknown>> : [];
  const claimRows = claims.map((claim) => `<tr><td>${escapeHtml(claim.claim_type)}</td><td>${escapeHtml(claim.claim_text)}</td><td><a href="${escapeHtml(claim.source_url)}">${escapeHtml(claim.source_domain || claim.source_url)}</a></td><td>${escapeHtml(claim.verification_status)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(evidence.title || evidence.topic)}</title><meta name="description" content="${escapeHtml(evidence.metaDescription)}"><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;line-height:1.65;color:#172033}article{border-top:1px solid #ccd3df;padding-top:1rem}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{border:1px solid #ccd3df;padding:.5rem;text-align:left;vertical-align:top}code,pre{white-space:pre-wrap;word-break:break-word}.status{padding:.4rem .7rem;background:${evidence.passed ? '#dcfce7' : '#fee2e2'};display:inline-block;border-radius:.4rem}</style></head>
<body><p class="status">${evidence.passed ? 'CANARY PASS' : 'CANARY REVIEW REQUIRED'}</p>
<h1>${escapeHtml(evidence.title || evidence.topic)}</h1><p>${escapeHtml(evidence.metaDescription)}</p>
<dl><dt>Quality score</dt><dd>${escapeHtml(evidence.qualityScore)}</dd><dt>Flash / Pro</dt><dd>${evidence.flashCalls} / ${evidence.proCalls}</dd><dt>AI cost</dt><dd>$${Number(evidence.aiCostUsd).toFixed(8)}</dd><dt>Trace ID</dt><dd><code>${escapeHtml(evidence.traceId)}</code></dd><dt>Disposition</dt><dd>${escapeHtml(evidence.disposition)}</dd><dt>Publication / indexing</dt><dd>${evidence.publicationCount} / ${evidence.indexingSideEffects}</dd></dl>
<article><h2>본문</h2>${safeArticleHtml(body) || '<p>본문 없음</p>'}</article>
<section><h2>Claim ledger</h2><table><thead><tr><th>Type</th><th>Claim</th><th>Source</th><th>Verification</th></tr></thead><tbody>${claimRows || '<tr><td colspan="4">공식 claim ledger 없음</td></tr>'}</tbody></table></section>
<section><h2>Canary evidence</h2><pre>${escapeHtml(JSON.stringify(evidence, null, 2))}</pre></section></body></html>`;
}

async function main() {
  const operationId = requiredArgument('operation-id');
  const outputDir = requiredArgument('output-dir');
  const dbClient = db();
  if (process.argv.includes('--diagnostic-only')) {
    await mkdir(outputDir, { recursive: true });
    const diagnostic = await readOperationDiagnostics(dbClient, operationId);
    await writeFile(join(outputDir, 'operation-diagnostic.json'), JSON.stringify(diagnostic, null, 2) + '\n', 'utf8');
    process.stdout.write(JSON.stringify({ operationId, diagnostic: true, outputDir }) + '\n');
    return;
  }
  const operation = await waitForOperation(dbClient, operationId);
  const artifact = await readArtifacts(db(), operation);
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'index.html'), htmlDocument(artifact), 'utf8');
  await writeFile(join(outputDir, 'evidence.json'), JSON.stringify(artifact.evidence, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    operationId,
    outputDir,
    passed: artifact.passed,
    candidateCount: artifact.evidence.candidateCount,
    flashCalls: artifact.evidence.flashCalls,
    proCalls: artifact.evidence.proCalls,
    aiCostUsd: artifact.evidence.aiCostUsd,
    publicationCount: artifact.evidence.publicationCount,
    indexingSideEffects: artifact.evidence.indexingSideEffects,
  }) + '\n');
  if (!artifact.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`blog V4 canary artifact export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
