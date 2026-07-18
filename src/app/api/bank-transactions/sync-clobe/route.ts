import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  fetchClobeMcpBankTransactions,
  normalizeClobeBankTransactions,
  processBankTransactionImportRows,
} from '@/lib/settlement-import';

export const runtime = 'nodejs';

function defaultDateWindow() {
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 24 * 60 * 60_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
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

    let rawPayload: unknown = body.transactions;
    let mcp: { toolName: string | null; toolNames: string[] } = { toolName: null, toolNames: [] };

    if (!Array.isArray(rawPayload)) {
      const fetched = await fetchClobeMcpBankTransactions({ from, to, accountNumber, limit });
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
      mcp,
      normalized: normalized.rows.length,
      normalizeErrors: normalized.errors,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Clobe sync failed';
    const status = /CLOBE_MCP_BEARER_TOKEN|CLOBE_API_TOKEN|No Clobe MCP transaction tool|401|403/i.test(message)
      ? 503
      : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
