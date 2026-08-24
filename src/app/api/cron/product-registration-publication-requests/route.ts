import { NextResponse } from 'next/server';
import { start } from 'workflow/api';

import { withCronGuard } from '@/lib/cron-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { productRegistrationPublicationWorkflow } from '@/workflows/product-registration-publication';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type DispatchRow = {
  publication_request_id?: unknown;
  status?: unknown;
};

type PublicationDispatchRpc = {
  rpc(
    name: 'list_product_registration_publication_dispatches',
    params: { p_limit: number },
  ): Promise<{ data: unknown; error: unknown }>;
};

const handler = async () => {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const { data, error } = await (supabase as unknown as PublicationDispatchRpc).rpc('list_product_registration_publication_dispatches', {
    p_limit: 10,
  });
  if (error) throw error;
  const dispatches = Array.isArray(data) ? data as DispatchRow[] : [];
  const publicBaseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL
    || process.env.NEXT_PUBLIC_BASE_URL
    || 'https://www.yeosonam.com'
  ).replace(/\/$/u, '');
  const results: Array<Record<string, unknown>> = [];
  for (const dispatch of dispatches) {
    const publicationRequestId = typeof dispatch.publication_request_id === 'string'
      ? dispatch.publication_request_id
      : '';
    if (!publicationRequestId) continue;
    try {
      const run = await start(productRegistrationPublicationWorkflow, [{
        publicationRequestId,
        requestBaseUrl: publicBaseUrl,
        publicBaseUrl,
      }]);
      results.push({ publicationRequestId, workflowRunId: run.runId, ok: true });
    } catch (startError) {
      results.push({
        publicationRequestId,
        ok: false,
        error: startError instanceof Error ? startError.message : String(startError),
      });
    }
  }
  return NextResponse.json(
    { success: true, checked: dispatches.length, results },
    { headers: { 'Cache-Control': 'no-store' } },
  );
};

export const GET = withCronGuard(handler);
