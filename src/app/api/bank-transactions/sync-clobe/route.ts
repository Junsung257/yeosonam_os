import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAdminRequest } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { resolveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import {
  chooseClobeAccountNumberFromMetadataRows,
  fetchClobeMcpBankTransactions,
  normalizeClobeBankTransactions,
  processBankTransactionImportRows,
} from '@/lib/settlement-import';
import { YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER } from '@/lib/bank-account-reality';
import {
  detectPostCloseSettlementChanges,
  refreshClobeFinanceClassifications,
  syncOpenMonthlySettlementExceptions,
} from '@/lib/finance-center-service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getRawSampleKeys(payload: unknown): string[][] {
  if (!Array.isArray(payload)) return [];
  return payload
    .slice(0, 3)
    .map(item => (item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item as Record<string, unknown>).slice(0, 20) : []))
    .filter(keys => keys.length > 0);
}

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
  const { data: clobeConnections } = await supabaseAdmin
    .from('tenant_api_tokens')
    .select('tenant_id')
    .eq('provider', 'clobe')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (clobeConnections?.[0]?.tenant_id) return clobeConnections[0].tenant_id;

  const { data } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? null;
}

async function resolveAccountNumber(rawAccountNumber: unknown): Promise<string | undefined> {
  if (typeof rawAccountNumber === 'string' && rawAccountNumber.trim()) {
    return rawAccountNumber.trim();
  }

  const { data } = await supabaseAdmin
    .from('bank_transactions')
    .select('source_metadata')
    .eq('source', 'clobe_mcp')
    .neq('status', 'excluded')
    .order('received_at', { ascending: false })
    .limit(500);
  return chooseClobeAccountNumberFromMetadataRows(data ?? [])
    ?? YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  }

  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  try {
    const syncStartedAt = new Date().toISOString();
    const body = await request.json().catch(() => ({}));
    const preview = body.preview === true || body.dryRun === true;
    const diagnosticsOnly = body.diagnosticsOnly === true;
    const window = defaultDateWindow();
    const from = typeof body.from === 'string' && body.from ? body.from : window.from;
    const to = typeof body.to === 'string' && body.to ? body.to : window.to;
    let accountNumber = await resolveAccountNumber(body.accountNumber);
    const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(1000, Number(body.limit))) : 1000;
    const tenantId = await resolveTenantId(body.tenant_id ?? body.tenantId);

    let rawPayload: unknown = body.transactions;
    let mcp: {
      toolName: string | null;
      toolNames: string[];
      bankToolAvailable: boolean;
      truncated: boolean;
      nextCursor: string | null;
      attempts: Array<{ toolName: string; extracted: number; normalized: number; resultKeys: string[]; contentTypes: string[]; resultShape: unknown; error?: string }>;
      scrapingStatus: Array<{
        assetType: string | null;
        status: string | null;
        scrapedAt: string | null;
        failureCategory: string | null;
        failureMessage: string | null;
      }>;
      scrapingStatusError?: string;
      tools: Array<{
        name: string;
        description: string | null;
        required: string[];
        properties: string[];
        inputFields: Array<{
          path: string;
          type: string | null;
          required: boolean;
          description: string | null;
          values: string[];
        }>;
      }>;
    } = { toolName: null, toolNames: [], bankToolAvailable: false, truncated: false, nextCursor: null, attempts: [], scrapingStatus: [], tools: [] };

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
      if (!accountNumber && typeof token.metadata?.bankAccountNumber === 'string') {
        accountNumber = token.metadata.bankAccountNumber.trim() || undefined;
      }
      const fetched = await fetchClobeMcpBankTransactions({
        from,
        to,
        accountNumber,
        limit,
        accessToken: token.accessToken,
        diagnosticsOnly,
      });
      rawPayload = fetched.transactions;
      mcp = {
        toolName: fetched.toolName,
        toolNames: fetched.toolNames,
        bankToolAvailable: fetched.bankToolAvailable,
        truncated: fetched.truncated,
        nextCursor: fetched.nextCursor,
        attempts: fetched.attempts,
        scrapingStatus: fetched.scrapingStatus,
        scrapingStatusError: fetched.scrapingStatusError,
        tools: fetched.tools,
      };
      if (fetched.truncated) {
        return NextResponse.json({
          success: false,
          code: 'clobe_sync_window_too_dense',
          error: `${from} ~ ${to} 기간에 ${limit}건을 초과하는 거래가 있습니다. 누락 방지를 위해 기간을 나눠 다시 동기화해주세요.`,
          mcp,
        }, { status: 409 });
      }
    }

    const fetched = Array.isArray(rawPayload) ? rawPayload.length : 0;
    const normalized = normalizeClobeBankTransactions(rawPayload);
    const rawSampleKeys = normalized.rows.length === 0 ? getRawSampleKeys(rawPayload) : [];
    const result = await processBankTransactionImportRows(normalized.rows, {
      source: 'clobe_mcp',
      preview: preview || diagnosticsOnly,
      actor: 'clobe_sync',
      createMissingBookings: !preview && !diagnosticsOnly,
    });
    console.info('[clobe-bank-sync]', {
      from,
      to,
      limit,
      preview,
      diagnosticsOnly,
      fetched,
      normalized: normalized.rows.length,
      normalizeErrors: normalized.errors.length,
      inserted: result.inserted,
      matched: result.matched,
      merged: result.merged,
      duplicates: result.duplicates,
      skipped: result.skipped,
      errors: result.errors,
      mcpToolName: mcp.toolName,
      mcpToolCount: mcp.toolNames.length,
      mcpAttempts: mcp.attempts.map(attempt => ({
        toolName: attempt.toolName,
        extracted: attempt.extracted,
        resultKeys: attempt.resultKeys,
        contentTypes: attempt.contentTypes,
        error: attempt.error,
      })),
    });

    let postCloseChanges = { checked: 0, changed: 0 };
    let classificationRefresh = {
      processed: 0,
      review: 0,
      allocationInserted: 0,
      allocationUpdated: 0,
      allocationNonExact: 0,
    };
    let monthlyExceptions = { scanned: 0, candidates: 0, inserted: 0, resolved: 0 };
    if (!preview && !diagnosticsOnly) {
      let classificationRefreshError: string | null = null;
      let postCloseDetectionError: string | null = null;
      let monthlyExceptionError: string | null = null;
      try {
        classificationRefresh = await refreshClobeFinanceClassifications();
      } catch (classificationError) {
        classificationRefreshError = classificationError instanceof Error
          ? classificationError.message
          : 'classification refresh failed';
        Sentry.captureException(classificationError, { tags: { area: 'clobe-finance-classification' } });
        console.error('[clobe-bank-sync] classification refresh failed:', classificationRefreshError);
      }
      try {
        postCloseChanges = await detectPostCloseSettlementChanges();
      } catch (detectionError) {
        postCloseDetectionError = detectionError instanceof Error
          ? detectionError.message
          : 'post-close detection failed';
        Sentry.captureException(detectionError, { tags: { area: 'clobe-post-close-detection' } });
        console.error('[clobe-bank-sync] post-close detection failed:', postCloseDetectionError);
      }
      try {
        monthlyExceptions = await syncOpenMonthlySettlementExceptions();
      } catch (exceptionError) {
        monthlyExceptionError = exceptionError instanceof Error
          ? exceptionError.message
          : 'monthly settlement exception sync failed';
        Sentry.captureException(exceptionError, { tags: { area: 'clobe-monthly-exception-sync' } });
        console.error('[clobe-bank-sync] monthly exception sync failed:', monthlyExceptionError);
      }

      const completedAt = new Date().toISOString();
      const supplementalErrorCount = Number(Boolean(classificationRefreshError))
        + Number(Boolean(postCloseDetectionError))
        + Number(Boolean(monthlyExceptionError));
      const syncStatus = result.errors > 0 || normalized.errors.length > 0 || supplementalErrorCount > 0
        ? 'partial'
        : 'success';
      const { error: syncRunError } = await supabaseAdmin.from('finance_sync_runs').insert({
        provider: 'clobe',
        account_number: accountNumber ?? YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER,
        range_from: from,
        range_to: to,
        source_count: fetched,
        recognized_count: normalized.rows.length,
        inserted_count: result.inserted,
        matched_count: result.matched,
        duplicate_count: result.duplicates,
        error_count: result.errors + normalized.errors.length + supplementalErrorCount,
        status: syncStatus,
        details: {
          tool_name: mcp.toolName,
          merged: result.merged,
          skipped: result.skipped,
          classification_refresh: classificationRefresh,
          classification_refresh_error: classificationRefreshError,
          post_close_changes: postCloseChanges,
          post_close_detection_error: postCloseDetectionError,
          monthly_exceptions: monthlyExceptions,
          monthly_exception_error: monthlyExceptionError,
        },
        started_at: syncStartedAt,
        completed_at: completedAt,
      });
      if (syncRunError) console.error('[clobe-bank-sync] sync run ledger failed:', syncRunError.message);
    }

    return NextResponse.json({
      success: true,
      source: 'clobe_mcp',
      preview,
      diagnosticsOnly,
      from,
      to,
      accountNumber: accountNumber ?? null,
      limit,
      tenantId,
      mcp,
      fetched,
      rawSampleKeys,
      normalized: normalized.rows.length,
      normalizeErrors: normalized.errors,
      postCloseChanges,
      classificationRefresh,
      monthlyExceptions,
      ...result,
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'clobe-bank-sync' } });
    const message = error instanceof Error ? error.message : 'Clobe sync failed';
    const status = /Clobe OAuth connection|No Clobe MCP .*transaction tool|401|403/i.test(message)
      ? 503
      : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
