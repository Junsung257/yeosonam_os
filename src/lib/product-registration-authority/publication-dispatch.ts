import type { SupabaseClient } from '@supabase/supabase-js';
import { start } from 'workflow/api';

import { productRegistrationPublicationWorkflow } from '@/workflows/product-registration-publication';

type DispatchRow = {
  publication_request_id?: unknown;
};

type PublicationDispatchRpc = {
  rpc(
    name: 'list_product_registration_publication_dispatches',
    params: { p_limit: number },
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function dispatchProductRegistrationPublicationRequests(input: {
  supabase: SupabaseClient;
  limit?: number;
  requestBaseUrl: string;
  publicBaseUrl: string;
}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 10)));
  const { data, error } = await (input.supabase as unknown as PublicationDispatchRpc).rpc(
    'list_product_registration_publication_dispatches',
    { p_limit: limit },
  );
  if (error) throw new Error(error.message || 'PUBLICATION_DISPATCH_LIST_FAILED');

  const dispatches = Array.isArray(data) ? data as DispatchRow[] : [];
  const results: Array<Record<string, unknown>> = [];
  for (const dispatch of dispatches) {
    const publicationRequestId = typeof dispatch.publication_request_id === 'string'
      ? dispatch.publication_request_id.trim()
      : '';
    if (!publicationRequestId) continue;
    try {
      const run = await start(productRegistrationPublicationWorkflow, [{
        publicationRequestId,
        requestBaseUrl: input.requestBaseUrl,
        publicBaseUrl: input.publicBaseUrl,
      }]);
      results.push({ publicationRequestId, workflowRunId: run.runId, ok: true });
    } catch (error) {
      results.push({
        publicationRequestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
