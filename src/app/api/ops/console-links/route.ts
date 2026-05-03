/**
 * GET /api/ops/console-links
 *
 * 어드민에서 외부 콘솔로 바로 갈 수 있는 URL (비밀 미포함).
 * - Supabase: SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL 호스트에서 project ref 추출
 * - Vercel: 팀·프로젝트 슬러그는 `src/lib/vercel-ops-defaults.ts` (MCP로 확인한 여소남 OS 기본값) +
 *   환경 변수 VERCEL_OPS_* / OPS_VERCEL_DASHBOARD_URL 로 덮어쓰기
 */
import { NextResponse } from 'next/server';
import { getVercelOpsProjectBaseUrl } from '@/lib/vercel-ops-defaults';

export const runtime = 'nodejs';

function supabaseDashboardUrl(): string | null {
  const raw = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw || raw.includes('your_supabase')) return null;
  try {
    const host = new URL(raw).hostname;
    const m = host.match(/^([a-z0-9]{20,})\.supabase\.co$/i);
    if (m) return `https://supabase.com/dashboard/project/${m[1]}`;
  } catch {
    /* noop */
  }
  return null;
}

export async function GET() {
  const supabase = supabaseDashboardUrl();
  const base = getVercelOpsProjectBaseUrl();
  const vercelCustom = process.env.OPS_VERCEL_DASHBOARD_URL?.trim();

  const vercel_cron =
    vercelCustom && /^https?:\/\//i.test(vercelCustom) ? vercelCustom : `${base}/settings/cron-jobs`;
  const vercel_environment = `${base}/settings/environment-variables`;
  const vercel_project = base;

  return NextResponse.json({
    supabase_dashboard: supabase,
    vercel_project,
    vercel_cron,
    vercel_environment,
    vercel_cron_docs: 'https://vercel.com/docs/cron-jobs',
    hints: {
      vercel_env: 'Cron·환경 변수: 아래 버튼으로 Vercel 프로젝트 설정으로 이동',
      supabase_env: 'DB·SQL: Supabase → Project → SQL Editor / Table Editor',
    },
    meta: {
      link_source: vercelCustom ? 'OPS_VERCEL_DASHBOARD_URL' : 'vercel-ops-defaults + env',
    },
  });
}
