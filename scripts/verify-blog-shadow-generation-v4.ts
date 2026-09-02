import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { evaluateBlogShadowGenerationV4 } from '../src/lib/blog-shadow-generation-verification-v4';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readQueueId(): string {
  const explicit = argument('queue-id');
  if (explicit) return explicit;
  const summaryPath = argument('dispatch-summary');
  if (!summaryPath) throw new Error('usage: --queue-id=<uuid> or --dispatch-summary=<json>');
  const summary = JSON.parse(readFileSync(resolve(summaryPath), 'utf8')) as { queueId?: unknown };
  if (typeof summary.queueId !== 'string' || !summary.queueId) {
    throw new Error('shadow_dispatch_summary_queue_id_missing');
  }
  return summary.queueId;
}

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function main(): Promise<void> {
  if (process.argv.includes('--apply')) {
    throw new Error('blog shadow generation verification is permanently read-only');
  }
  const queueId = readQueueId();
  const timeoutSeconds = positiveInteger(argument('timeout-seconds'), 900);
  const pollSeconds = positiveInteger(argument('poll-seconds'), 15);
  const outputPath = argument('output');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('shadow_verification_supabase_credentials_missing');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const startedAt = Date.now();
  let latest: ReturnType<typeof evaluateBlogShadowGenerationV4> | null = null;

  while (Date.now() - startedAt <= timeoutSeconds * 1_000) {
    const queueResult = await supabase
      .from('blog_topic_queue')
      .select('id,status,last_error')
      .eq('id', queueId)
      .maybeSingle();
    if (queueResult.error) throw new Error(`shadow_queue_read_failed:${queueResult.error.message}`);

    const runResult = await supabase
      .from('blog_generation_runs')
      .select('id,queue_id,content_creative_id,selected_attempt_id,status,disposition,last_error')
      .eq('queue_id', queueId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runResult.error) throw new Error(`shadow_run_read_failed:${runResult.error.message}`);

    const attemptsResult = runResult.data?.id
      ? await supabase
        .from('blog_generation_attempts')
        .select('id,run_id,queue_id,status,route')
        .eq('run_id', runResult.data.id)
      : { data: [], error: null };
    if (attemptsResult.error) throw new Error(`shadow_attempt_read_failed:${attemptsResult.error.message}`);

    const creativeResult = runResult.data?.content_creative_id
      ? await supabase
        .from('content_creatives')
        .select('id,status,published_at')
        .eq('id', runResult.data.content_creative_id)
        .maybeSingle()
      : { data: null, error: null };
    if (creativeResult.error) throw new Error(`shadow_creative_read_failed:${creativeResult.error.message}`);

    const indexingResult = runResult.data?.content_creative_id
      ? await supabase
        .from('blog_indexing_jobs')
        .select('id,content_creative_id')
        .eq('content_creative_id', runResult.data.content_creative_id)
      : { data: [], error: null };
    if (indexingResult.error) throw new Error(`shadow_indexing_read_failed:${indexingResult.error.message}`);

    latest = evaluateBlogShadowGenerationV4({
      queue: queueResult.data,
      run: runResult.data,
      attempts: attemptsResult.data ?? [],
      creative: creativeResult.data,
      indexingJobs: indexingResult.data ?? [],
    });
    process.stdout.write(`shadow queue=${queueId} state=${latest.state} reason=${latest.reason}\n`);

    if (latest.state !== 'pending') {
      const report = {
        readOnly: true,
        queueId,
        checkedAt: new Date().toISOString(),
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1_000),
        decision: latest,
      };
      if (outputPath) {
        const absoluteOutput = resolve(outputPath);
        mkdirSync(dirname(absoluteOutput), { recursive: true });
        writeFileSync(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      }
      if (latest.state === 'failed') throw new Error(latest.reason);
      return;
    }
    await delay(pollSeconds * 1_000);
  }

  throw new Error(`shadow_generation_verification_timeout:${latest?.reason || 'no_observation'}`);
}

main().catch((error) => {
  process.stderr.write(`blog shadow generation v4 verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
