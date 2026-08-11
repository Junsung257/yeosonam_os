import { getReadOnlySupabaseV3, loadCorpusRowsV3, planCorpusDispositionV3 } from './lib/blog-corpus-v3';

async function main(): Promise<void> {
 const apply = process.argv.includes('--apply');
 const client = getReadOnlySupabaseV3();
 const candidates = planCorpusDispositionV3(await loadCorpusRowsV3(client)).filter((row) => row.action === 'QUARANTINE');
 console.log(JSON.stringify({ dry_run: !apply, candidates }, null, 2));
 if (!apply) return;
 if (process.env.BLOG_CORPUS_APPLY_CONFIRM !== 'QUARANTINE_REVIEWED_2026_08_11') throw new Error('apply_confirmation_missing');
 for (const candidate of candidates) {
  const { data: current, error: readError } = await client.from('content_creatives')
    .select('generation_meta')
    .eq('id', candidate.creative_id)
    .single();
  if (readError) throw new Error(`quarantine_preread_failed:${candidate.creative_id}:${readError.message}`);
  const { error } = await client.from('content_creatives').update({
    status: 'archived',
    generation_meta: {
      ...((current?.generation_meta as Record<string, unknown> | null) || {}),
      corpus_v3_quarantine: { reason: candidate.reason, applied_at: new Date().toISOString() },
      noindex: true,
    },
  }).eq('id', candidate.creative_id);
  if (error) throw new Error(`quarantine_failed:${candidate.creative_id}:${error.message}`);
 }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
