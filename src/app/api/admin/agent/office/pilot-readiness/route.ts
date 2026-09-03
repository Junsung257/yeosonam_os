import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { requirePlatformAdminRequest } from '@/lib/admin-guard';
import { buildTechnologyScoutPilotReadiness } from '@/lib/agent/pilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = await requirePlatformAdminRequest(request);
  if (authError) return authError;

  // Live process attestation is intentionally local/preview-only. Production
  // must not spawn a subscription worker from a dashboard read request.
  const response = apiResponse(buildTechnologyScoutPilotReadiness({
    generatedAt: new Date().toISOString(),
  }));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
