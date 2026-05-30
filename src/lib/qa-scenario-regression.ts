import { createV1QaChatStream } from '@/lib/qa-chat-engine';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { createHash } from 'crypto';

type ScenarioStatus = 'pending' | 'active' | 'archived';

type QaLearningScenarioRow = {
  id: string;
  category: string;
  destination_hint: string | null;
  user_message_redacted: string;
  expected_behavior: Record<string, unknown> | null;
  priority: number;
  status: ScenarioStatus;
};

type StreamEvent =
  | { type: 'text'; content?: string }
  | { type: 'text_final'; content?: string }
  | { type: 'meta'; packages?: unknown[]; escalate?: boolean; freeTravelHref?: string | null; critiqueSeverity?: string }
  | { type: 'error'; message?: string }
  | { type: 'done' };

type ScenarioCheck = {
  name: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
};

function sha256(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase(), 'utf8').digest('hex');
}

export type QaScenarioRunResult = {
  scenarioId: string;
  category: string;
  passed: boolean;
  score: number;
  checks: ScenarioCheck[];
  elapsedMs: number;
  responsePreview: string;
  meta: {
    packageCount: number;
    packageIds: string[];
    packageDestinations: Array<string | null>;
    freeTravelHref: string | null;
    escalate: boolean;
    critiqueSeverity: string | null;
  };
  error?: string;
};

function asBoolean(value: unknown): boolean {
  return value === true;
}

function extractPackageLinks(text: string): string[] {
  return Array.from(text.matchAll(/\/packages\/([a-zA-Z0-9-]+)/g)).map((m) => m[1]);
}

function packageField(item: unknown, key: string): unknown {
  if (!item || typeof item !== 'object') return null;
  return (item as Record<string, unknown>)[key] ?? null;
}

async function collectQaStream(message: string): Promise<{
  events: StreamEvent[];
  text: string;
  meta: Extract<StreamEvent, { type: 'meta' }> | null;
}> {
  const stream = await createV1QaChatStream({
    message,
    history: [],
    sessionId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
  });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: StreamEvent[] = [];

  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        try {
          events.push(JSON.parse(line) as StreamEvent);
        } catch {
          events.push({ type: 'error', message: `invalid json event: ${line.slice(0, 80)}` });
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
    if (done) break;
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      events.push(JSON.parse(tail) as StreamEvent);
    } catch {
      events.push({ type: 'error', message: `invalid json event: ${tail.slice(0, 80)}` });
    }
  }

  const text = events
    .filter((e) => e.type === 'text' || e.type === 'text_final')
    .map((e) => e.content ?? '')
    .join('');
  const meta = events.find((e): e is Extract<StreamEvent, { type: 'meta' }> => e.type === 'meta') ?? null;
  return { events, text, meta };
}

function evaluateScenario(
  scenario: QaLearningScenarioRow,
  streamResult: Awaited<ReturnType<typeof collectQaStream>>,
  elapsedMs: number,
): QaScenarioRunResult {
  const expected = scenario.expected_behavior ?? {};
  const metaPackages = Array.isArray(streamResult.meta?.packages) ? streamResult.meta.packages : [];
  const packageIds = metaPackages
    .map((p) => packageField(p, 'id'))
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  const packageDestinations = metaPackages.map((p) => {
    const value = packageField(p, 'destination');
    return typeof value === 'string' ? value : null;
  });
  const textPackageLinks = extractPackageLinks(streamResult.text);
  const freeTravelHref = typeof streamResult.meta?.freeTravelHref === 'string' ? streamResult.meta.freeTravelHref : null;
  const escalate = streamResult.meta?.escalate === true;
  const eventError = streamResult.events.find((e) => e.type === 'error') as Extract<StreamEvent, { type: 'error' }> | undefined;
  const hasDone = streamResult.events.some((e) => e.type === 'done');

  const checks: ScenarioCheck[] = [
    {
      name: 'stream_completed',
      passed: hasDone && !eventError,
      expected: 'done without error event',
      actual: eventError?.message ?? (hasDone ? 'done' : 'missing done'),
    },
    {
      name: 'has_customer_reply',
      passed: streamResult.text.trim().length >= 12,
      expected: 'non-empty customer-facing reply',
      actual: streamResult.text.trim().length,
    },
  ];

  if (asBoolean(expected.escalate) || asBoolean(expected.handoff)) {
    checks.push({
      name: 'handoff_required',
      passed: escalate,
      expected: true,
      actual: escalate,
    });
  }
  if (expected.packageLinks === false) {
    checks.push({
      name: 'no_package_links_expected',
      passed: packageIds.length === 0 && textPackageLinks.length === 0,
      expected: 0,
      actual: { cards: packageIds.length, links: textPackageLinks.length },
    });
  }
  if (asBoolean(expected.freeTravelCta)) {
    checks.push({
      name: 'free_travel_cta',
      passed: Boolean(freeTravelHref),
      expected: true,
      actual: freeTravelHref,
    });
  }
  if (asBoolean(expected.noInvalidPackageLinks)) {
    const valid = new Set(packageIds);
    const invalidLinks = textPackageLinks.filter((id) => !valid.has(id));
    checks.push({
      name: 'no_invalid_package_links',
      passed: invalidLinks.length === 0,
      expected: [],
      actual: invalidLinks,
    });
  }
  if (asBoolean(expected.packageLinksWhenAvailable) && packageIds.length > 0) {
    checks.push({
      name: 'package_cards_or_links_present',
      passed: packageIds.length > 0 || textPackageLinks.length > 0,
      expected: 'approved package card/link',
      actual: { cards: packageIds.length, links: textPackageLinks.length },
    });
  }
  if (asBoolean(expected.noFalsePackageCards) && scenario.destination_hint && packageDestinations.length > 0) {
    const falseDestinations = packageDestinations.filter((d) => d && !d.includes(scenario.destination_hint!));
    checks.push({
      name: 'no_false_destination_cards',
      passed: falseDestinations.length === 0,
      expected: scenario.destination_hint,
      actual: falseDestinations,
    });
  }

  const passedCount = checks.filter((c) => c.passed).length;
  const score = checks.length > 0 ? Math.round((passedCount / checks.length) * 1000) / 10 : 0;

  return {
    scenarioId: scenario.id,
    category: scenario.category,
    passed: checks.every((c) => c.passed),
    score,
    checks,
    elapsedMs,
    responsePreview: streamResult.text.replace(/\s+/g, ' ').slice(0, 240),
    meta: {
      packageCount: packageIds.length,
      packageIds,
      packageDestinations,
      freeTravelHref,
      escalate,
      critiqueSeverity: typeof streamResult.meta?.critiqueSeverity === 'string' ? streamResult.meta.critiqueSeverity : null,
    },
  };
}

async function runOneScenario(scenario: QaLearningScenarioRow): Promise<QaScenarioRunResult> {
  const started = Date.now();
  try {
    const streamResult = await collectQaStream(scenario.user_message_redacted);
    return evaluateScenario(scenario, streamResult, Date.now() - started);
  } catch (e) {
    return {
      scenarioId: scenario.id,
      category: scenario.category,
      passed: false,
      score: 0,
      checks: [{
        name: 'runtime_error',
        passed: false,
        expected: 'successful scenario execution',
        actual: e instanceof Error ? e.message : 'unknown',
      }],
      elapsedMs: Date.now() - started,
      responsePreview: '',
      meta: {
        packageCount: 0,
        packageIds: [],
        packageDestinations: [],
        freeTravelHref: null,
        escalate: false,
        critiqueSeverity: null,
      },
      error: e instanceof Error ? e.message : 'unknown',
    };
  }
}

async function createImprovementCandidate(
  scenario: QaLearningScenarioRow,
  result: QaScenarioRunResult,
): Promise<void> {
  if (result.passed || !isSupabaseConfigured) return;
  const failedChecks = result.checks.filter((c) => !c.passed).map((c) => c.name);
  if (failedChecks.length === 0) return;

  const pattern = `qa_scenario_failed:${scenario.category}:${failedChecks.join(',')}`;
  const patternHash = sha256([
    'qa_scenario_regression',
    scenario.category,
    scenario.destination_hint ?? '-',
    failedChecks.join('|'),
  ].join('|'));

  const { data: existing } = await supabaseAdmin
    .from('response_corrections')
    .select('id')
    .eq('pattern_hash', patternHash)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return;

  await supabaseAdmin.from('response_corrections').insert({
    source: 'qa_chat',
    scope_destination: scenario.destination_hint,
    pattern,
    pattern_hash: patternHash,
    bad_example: result.responsePreview || scenario.user_message_redacted,
    good_example: [
      'Admin review required before activation.',
      `Expected behavior: ${JSON.stringify(scenario.expected_behavior ?? {})}`,
      `Failed checks: ${failedChecks.join(', ')}`,
    ].join('\n'),
    severity: failedChecks.some((name) => name.includes('handoff') || name.includes('invalid')) ? 'block' : 'warn',
    is_active: false,
    applied_count: 0,
    created_by: 'system:qa-scenario-regression',
    metadata: {
      scenario_id: scenario.id,
      category: scenario.category,
      score: result.score,
      checks: result.checks,
      meta: result.meta,
      runner_version: 'qa-scenario-regression-v1',
    },
  } as never);
}

export async function runActiveQaLearningScenarios(options: { limit?: number } = {}): Promise<{
  total: number;
  passed: number;
  failed: number;
  runGroupId: string;
  results: QaScenarioRunResult[];
}> {
  const runGroupId = crypto.randomUUID();
  if (!isSupabaseConfigured) return { total: 0, passed: 0, failed: 0, runGroupId, results: [] };
  const limit = Math.max(1, Math.min(options.limit ?? Number(process.env.QA_SCENARIO_REGRESSION_LIMIT ?? 5), 20));
  const { data, error } = await supabaseAdmin
    .from('qa_learning_scenarios')
    .select('id, category, destination_hint, user_message_redacted, expected_behavior, priority, status')
    .eq('status', 'active')
    .order('priority', { ascending: false })
    .order('last_run_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw new Error(`qa_learning_scenarios load failed: ${error.message}`);
  const scenarios = (data ?? []) as QaLearningScenarioRow[];
  const results: QaScenarioRunResult[] = [];

  for (const scenario of scenarios) {
    const result = await runOneScenario(scenario);
    results.push(result);
    const now = new Date().toISOString();
    await Promise.allSettled([
      supabaseAdmin
        .from('qa_learning_scenarios')
        .update({
          last_run_at: now,
          last_result: result as unknown as Record<string, unknown>,
          updated_at: now,
        } as never)
        .eq('id', scenario.id),
      supabaseAdmin
        .from('qa_learning_scenario_runs')
        .insert({
          scenario_id: scenario.id,
          run_group_id: runGroupId,
          runner_version: 'qa-scenario-regression-v1',
          passed: result.passed,
          score: result.score,
          checks: result.checks,
          response_preview: result.responsePreview || null,
          meta: result.meta,
          error: result.error ?? null,
          elapsed_ms: result.elapsedMs,
        } as never),
      createImprovementCandidate(scenario, result),
    ]);
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    runGroupId,
    results,
  };
}
