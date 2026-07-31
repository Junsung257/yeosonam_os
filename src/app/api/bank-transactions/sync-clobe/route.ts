import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { resolveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import {
  fetchClobeMcpBankTransactions,
  normalizeClobeBankTransactions,
  processBankTransactionImportRows,
} from '@/lib/settlement-import';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultDateWindow() {
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 24 * 60 * 60_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

async function resolveTenantId(rawTenantId: unknown): Promise<string | null> {
  if (typeof rawTenantId === 'string' && UUID_RE.test(rawTenantId)) return rawTenantId;
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? null;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  }

  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const preview = body.preview === true || body.dryRun === true;
    const window = defaultDateWindow();
    const from = typeof body.from === 'string' && body.from ? body.from : window.from;
    const to = typeof body.to === 'string' && body.to ? body.to : window.to;
    const accountNumber = typeof body.accountNumber === 'string' && body.accountNumber ? body.accountNumber : undefined;
    const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(1000, Number(body.limit))) : 200;
    const tenantId = await resolveTenantId(body.tenant_id ?? body.tenantId);

    let rawPayload: unknown = body.transactions;
    let mcp: { toolName: string | null; toolNames: string[] } = { toolName: null, toolNames: [] };

    if (!Array.isArray(rawPayload)) {
      if (!tenantId) {
        return NextResponse.json(
          { success: false, error: 'tenant_id is required for Clobe sync', code: 'tenant_required' },
          { status: 400 },
        );
      }
      const token = await resolveOAuthToken(tenantId, 'clobe');
      if (!token?.accessToken) {
        return NextResponse.json(
          {
            success: false,
            error: 'Clobe connection is required. Connect Clobe in admin integrations first.',
            code: 'clobe_connection_required',
            connectUrl: '/admin/settings/integrations',
          },
          { status: 409 },
        );
      }
      const fetched = await fetchClobeMcpBankTransactions({ from, to, accountNumber, limit, accessToken: token.accessToken });
      rawPayload = fetched.transactions;
      mcp = { toolName: fetched.toolName, toolNames: fetched.toolNames };
    }

    const normalized = normalizeClobeBankTransactions(rawPayload);
    const result = await processBankTransactionImportRows(normalized.rows, {
      source: 'clobe_mcp',
      preview,
      actor: 'clobe_sync',
      createMissingBookings: !preview,
    });

    return NextResponse.json({
      success: true,
      source: 'clobe_mcp',
      preview,
      from,
      to,
      accountNumber: accountNumber ?? null,
      limit,
      tenantId,
      mcp,
      normalized: normalized.rows.length,
      normalizeErrors: normalized.errors,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Clobe sync failed';
    const status = /Clobe OAuth connection|No Clobe MCP transaction tool|401|403/i.test(message)
      ? 503
      : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
