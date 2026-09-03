import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { requirePlatformAdminRequest } from '@/lib/admin-guard';
import { getAgentOfficeReadiness } from '@/lib/agent-office-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = await requirePlatformAdminRequest(request);
  if (authError) return authError;

  const response = apiResponse({
    ...getAgentOfficeReadiness(),
    generatedAt: new Date().toISOString(),
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
