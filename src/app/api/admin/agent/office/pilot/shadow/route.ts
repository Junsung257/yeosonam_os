import { type NextRequest } from 'next/server';

import { apiResponse } from '@/lib/api-response';
import { requirePlatformAdminRequest } from '@/lib/admin-guard';
import { resolveTechnologyScoutShadowPilotEnvironment } from '@/lib/agent/pilot/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function localOnlyResponse() {
  const environment = resolveTechnologyScoutShadowPilotEnvironment();
  return apiResponse({
    code: 'SHADOW_PILOT_LOCAL_ONLY',
    error: 'Technology Scout 실행기는 로컬 격리 런타임에서만 연결됩니다.',
    execution: environment,
    executionMode: 'shadow_read_only',
    productionAccess: false,
    commandAccess: false,
    externalWrites: false,
  }, {
    status: 503,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

/**
 * The hosted API intentionally exposes only the contract boundary. The
 * worker requires a local Codex App Server, restricted-read roots, and a
 * Preview-only agent_runs migration; none of those are available in a
 * serverless deployment. Keeping the handler small avoids bundling the
 * worker graph and prevents Vercel build OOM while preserving a fail-closed
 * endpoint for the admin panel.
 */
export async function GET(request: NextRequest) {
  const authError = await requirePlatformAdminRequest(request);
  if (authError) return authError;
  return localOnlyResponse();
}

export async function POST(request: NextRequest) {
  const authError = await requirePlatformAdminRequest(request);
  if (authError) return authError;
  return localOnlyResponse();
}
