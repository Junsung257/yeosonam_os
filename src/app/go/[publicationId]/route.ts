import { NextRequest, NextResponse } from 'next/server';
import { buildPublicUrl, resolvePublicAppOrigin } from '@/lib/public-app-origin';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { isValidUuid } from '@/lib/supabase-filter-safe';

function safeInternalDestination(destinationUrl: string): string | null {
  try {
    const destination = new URL(destinationUrl);
    if (destination.origin !== resolvePublicAppOrigin()) return null;
    return `${destination.pathname}${destination.search}`;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ publicationId: string }> },
) {
  const { publicationId } = await context.params;
  if (!isSupabaseAdminConfigured || !isValidUuid(publicationId)) {
    return NextResponse.redirect(buildPublicUrl('/'), { status: 302 });
  }

  const { data, error } = await supabaseAdmin
    .from('affiliate_publications')
    .select('id, destination_url, status, sub_id')
    .eq('id', publicationId)
    .maybeSingle();

  const publication = data as {
    id: string;
    destination_url: string;
    status: string;
    sub_id: string | null;
  } | null;
  const next = publication ? safeInternalDestination(publication.destination_url) : null;
  if (error || !publication || !next || !['DRAFT', 'TESTED', 'PUBLISHED'].includes(publication.status)) {
    return NextResponse.redirect(buildPublicUrl('/'), { status: 302 });
  }

  const trackingUrl = new URL('/api/influencer/track', request.nextUrl.origin);
  trackingUrl.searchParams.set('publication', publication.id);
  trackingUrl.searchParams.set('next', next);
  if (publication.sub_id) trackingUrl.searchParams.set('sub', publication.sub_id);
  return NextResponse.redirect(trackingUrl, { status: 302 });
}
