import { NextRequest } from 'next/server';

import { apiResponse } from '@/lib/api-response';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import {
  evaluateDestinationMediaAutoApproval,
  verifyDestinationImageBinary,
} from '@/lib/destination-media-auto-approval';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

async function run(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ error: 'DB not configured' }, { status: 503 });
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? 25);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.floor(requestedLimit))) : 25;
  const { data, error } = await supabaseAdmin
    .from('destination_metadata')
    .select('destination, hero_image_url, hero_image_provider, hero_image_pexels_id, hero_image_source_page_url, hero_image_source_file_title, hero_image_license, hero_image_license_url, hero_photographer, hero_image_alt')
    .eq('photo_approved', false)
    .not('hero_image_url', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

  const results: Array<Record<string, unknown>> = [];
  for (const candidate of data ?? []) {
    const checkedAt = new Date().toISOString();
    const binaryVerified = typeof candidate.hero_image_url === 'string'
      ? await verifyDestinationImageBinary(candidate.hero_image_url)
      : false;
    const decision = evaluateDestinationMediaAutoApproval(candidate, { binaryVerified, checkedAt });
    if (!decision.approved) {
      results.push({ destination: candidate.destination, status: 'held', reason: decision.reason });
      continue;
    }

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

    results.push(updateError
      ? { destination: candidate.destination, status: 'error', error: sanitizeDbError(updateError) }
      : { destination: candidate.destination, status: 'approved', score: decision.score });
  }

  return apiResponse({
    scanned: results.length,
    approved: results.filter(row => row.status === 'approved').length,
    held: results.filter(row => row.status === 'held').length,
    failed: results.filter(row => row.status === 'error').length,
    results,
  });
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
