import { NextRequest, NextResponse } from 'next/server';
import { classifyMcpQuery } from '@/lib/ad-os-ai-director';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function compact(value: unknown, maxLength = 1200) {
  const text = JSON.stringify(value ?? {});
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const provider = String(body.provider || '');
  const toolName = String(body.tool_name || body.toolName || '');
  const classification = classifyMcpQuery({ provider, toolName, mode: body.mode });
  const persist = body.persist === true;

  if (persist && isSupabaseAdminConfigured) {
    const { error } = await supabaseAdmin
      .from('ad_os_mcp_tool_calls')
      .insert({
        tenant_id: body.tenant_id || null,
        run_id: body.run_id || null,
        provider: classification.provider,
        tool_name: classification.tool_name,
        mode: classification.mode,
        request_summary: compact(body.params || body.arguments || {}),
        response_summary: classification.allowed
          ? 'Read-only request accepted for broker wiring. No external MCP call was executed by this route.'
          : classification.reason,
        status: classification.allowed ? 'allowed' : 'blocked',
        safety: classification.safety,
      } as never);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    classification,
    executed: false,
    result: classification.allowed
      ? {
          status: 'not_executed',
          reason: 'This broker enforces read-only classification and audit. Connect a verified MCP runtime behind this route before execution.',
        }
      : null,
    safety: classification.safety,
  });
});
