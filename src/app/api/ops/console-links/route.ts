/**
 * GET /api/ops/console-links
 *
 * Returns admin console URLs for internal ops dashboards.
 * No secrets are returned; Supabase links are derived from the project ref only.
 */
import { apiResponse } from '@/lib/api-response';
import { getSecret } from '@/lib/secret-registry';
import { getVercelOpsProjectBaseUrl } from '@/lib/vercel-ops-defaults';

export const runtime = 'nodejs';

function supabaseDashboardUrl(): string | null {
  const raw = getSecret('SUPABASE_URL') || getSecret('NEXT_PUBLIC_SUPABASE_URL');
  if (!raw || raw.includes('your_supabase')) return null;
  try {
    const host = new URL(raw).hostname;
    const match = host.match(/^([a-z0-9]{20,})\.supabase\.co$/i);
    if (match) return `https://supabase.com/dashboard/project/${match[1]}`;
  } catch {
    /* ignore invalid configured URL */
  }
  return null;
}

export async function GET() {
  const supabase = supabaseDashboardUrl();
  const base = getVercelOpsProjectBaseUrl();
  const vercelCustom = getSecret('OPS_VERCEL_DASHBOARD_URL')?.trim();

  const vercel_cron =
    vercelCustom && /^https?:\/\//i.test(vercelCustom) ? vercelCustom : `${base}/settings/cron-jobs`;
  const vercel_environment = `${base}/settings/environment-variables`;
  const vercel_project = base;

  return apiResponse({
    supabase_dashboard: supabase,
    vercel_project,
    vercel_cron,
    vercel_environment,
    vercel_cron_docs: 'https://vercel.com/docs/cron-jobs',
    hints: {
      vercel_env: 'Vercel project settings에서 Cron과 환경 변수를 확인하세요.',
      supabase_env: 'Supabase dashboard에서 SQL Editor와 Table Editor를 확인하세요.',
    },
    meta: {
      link_source: vercelCustom ? 'OPS_VERCEL_DASHBOARD_URL' : 'vercel-ops-defaults + env',
    },
  });
}
