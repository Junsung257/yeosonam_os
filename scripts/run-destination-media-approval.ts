import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

async function main() {
  const apply = process.argv.includes('--apply');
  const [{ supabaseAdmin, isSupabaseConfigured }, approval] = await Promise.all([
    import('../src/lib/supabase'),
    import('../src/lib/destination-media-auto-approval'),
  ]);
  if (!isSupabaseConfigured || !supabaseAdmin) throw new Error('Supabase is not configured.');

  const { data, error } = await supabaseAdmin
    .from('destination_metadata')
    .select('destination, hero_image_url, hero_image_provider, hero_image_pexels_id, hero_image_source_page_url, hero_image_source_file_title, hero_image_license, hero_image_license_url, hero_photographer, hero_image_alt')
    .eq('photo_approved', false)
    .not('hero_image_url', 'is', null)
    .order('destination');
  if (error) throw error;

  const results: Array<Record<string, unknown>> = [];
  for (const candidate of data ?? []) {
    const checkedAt = new Date().toISOString();
    const binaryVerified = typeof candidate.hero_image_url === 'string'
      ? await approval.verifyDestinationImageBinary(candidate.hero_image_url)
      : false;
    const decision = approval.evaluateDestinationMediaAutoApproval(candidate, { binaryVerified, checkedAt });
    if (!decision.approved) {
      results.push({ destination: candidate.destination, status: 'held', reason: decision.reason });
      continue;
    }

    if (apply) {
      const { error: updateError } = await supabaseAdmin
        .from('destination_metadata')
        .update({
          photo_approved: true,
          photo_approved_at: checkedAt,
          photo_approval_source: 'automated_evidence_gate',
          photo_quality_score: decision.score,
          photo_verification_evidence: decision.evidence,
        })
        .eq('destination', candidate.destination)
        .eq('photo_approved', false);
      if (updateError) throw updateError;
    }
    results.push({ destination: candidate.destination, status: apply ? 'approved' : 'ready', score: decision.score });
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
