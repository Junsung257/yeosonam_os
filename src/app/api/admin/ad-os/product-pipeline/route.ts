import { NextRequest } from 'next/server';
import { runAdOsProductAutopilot, type ProductAutopilotResult } from '@/lib/ad-os-product-autopilot';
import { automationLevelToPublicMode, type AdOsPublicAutomationMode } from '@/lib/ad-os-v3-v7';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

type ProductPipelineBody = {
  package_id?: string;
  package_ids?: string[];
  automation_mode?: AdOsPublicAutomationMode;
  automation_level?: number;
  apply?: boolean;
  tenant_id?: string | null;
};

function modeToAutopilot(mode: AdOsPublicAutomationMode): 'dry_run' | 'guarded' | 'full' {
  if (mode === 'recommend') return 'dry_run';
  if (mode === 'full_autopilot') return 'full';
  return 'guarded';
}

function canApply(mode: AdOsPublicAutomationMode, requestedApply: boolean): boolean {
  if (!requestedApply) return false;
  return mode === 'approve' || mode === 'limited_autopilot' || mode === 'full_autopilot';
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = (await request.json().catch(() => ({}))) as ProductPipelineBody;
  const packageIds = [...new Set([...(body.package_ids || []), body.package_id].filter(Boolean) as string[])];
  if (packageIds.length === 0) {
    return apiResponse({ ok: false, error: 'package_id or package_ids is required' }, { status: 400 });
  }

  const publicMode = body.automation_mode || automationLevelToPublicMode(body.automation_level ?? 2);
  const mode = modeToAutopilot(publicMode);
  const apply = canApply(publicMode, Boolean(body.apply));
  const results: ProductAutopilotResult[] = [];

  for (const packageId of packageIds.slice(0, 30)) {
    results.push(await runAdOsProductAutopilot({
      packageId,
      mode,
      apply,
      tenantId: body.tenant_id ?? null,
      source: 'ad_os_product_pipeline',
    }));
  }

  const safeResults = results.map((result) => ({
    ...result,
    warnings: result.warnings.map((warning) => sanitizeDbError(warning)),
  }));

  return apiResponse({
    ok: results.every((result) => result.ok),
    automation_mode: publicMode,
    mode,
    apply,
    summary: {
      packages: results.length,
      scenarios_generated: results.reduce((sum, result) => sum + result.scenarios.generated, 0),
      scenarios_saved: results.reduce((sum, result) => sum + result.scenarios.saved, 0),
      blog_actions: results.reduce((sum, result) => sum + result.scenarios.queued_blog_actions, 0),
      landing_actions: results.reduce((sum, result) => sum + result.landing_evolution.queued, 0),
      search_keywords: results.reduce((sum, result) => sum + result.search_ads.keywords, 0),
    },
    results: safeResults,
  });
});
