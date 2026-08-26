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
  const { data: clobeConnections, error: clobeConnectionError } = await supabaseAdmin
    .from('tenant_api_tokens')
    .select('tenant_id')
    .eq('provider', 'clobe')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (clobeConnectionError) throw clobeConnectionError;
  if (clobeConnections?.[0]?.tenant_id) return clobeConnections[0].tenant_id;

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

async function resolveAccountNumber(rawAccountNumber: unknown): Promise<string | undefined> {
  if (typeof rawAccountNumber === 'string' && rawAccountNumber.trim()) {
    return rawAccountNumber.trim();
  }

  const { data, error } = await supabaseAdmin
    .from('bank_transactions')
    .select('source_metadata')
    .eq('source', 'clobe_mcp')
    .neq('status', 'excluded')
    .order('received_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return chooseClobeAccountNumberFromMetadataRows(data ?? [])
    ?? YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER;
}

async function resolveSettlementTenantScope(
  accountNumber: string | undefined,
  fallbackTenantId: string | null,
): Promise<string | null> {
  const normalizedAccount = (accountNumber ?? YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER).replace(/\D/g, '');
  const rows: Array<{ tenant_id?: string | null; account_number?: string | null }> = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('bank_transactions')
      .select('tenant_id, account_number')
      .eq('external_provider', 'clobe')
      .neq('status', 'excluded')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []).filter(row => (row.account_number ?? '').replace(/\D/g, '') === normalizedAccount));
    if ((data ?? []).length < pageSize) break;
  }
  const scopes = new Set(rows.map(row => row.tenant_id ?? 'platform'));
  if (scopes.size > 1) {
    throw new Error('Clobe account has more than one tenant scope; reconciliation is blocked');
  }
  if (rows.length > 0) return rows[0]?.tenant_id ?? null;
  return fallbackTenantId;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  }

  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  let activeRun: { runId: string; leaseToken: string } | null = null;
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
    const settlementTenantId = await resolveSettlementTenantScope(accountNumber, tenantId);
    const triggerSource = typeof body.triggerSource === 'string' && body.triggerSource.trim()
      ? body.triggerSource.trim()
      : 'manual';

    const ensureSyncLease = async (): Promise<{ runId: string; leaseToken: string } | null> => {
      if (preview || diagnosticsOnly || activeRun) return activeRun;
      const { data, error } = await supabaseAdmin.rpc('begin_clobe_sync_run', {
        p_tenant_id: settlementTenantId,
        p_account_number: accountNumber ?? YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER,
        p_range_from: from,
        p_range_to: to,
        p_trigger_source: triggerSource,
        p_lease_seconds: 1800,
      });
      if (error) throw error;
      const lease = data as { run_id?: unknown; lease_token?: unknown } | null;
      if (typeof lease?.run_id !== 'string' || typeof lease.lease_token !== 'string') {
        throw new Error('Clobe sync lease response is invalid');
      }
      activeRun = { runId: lease.run_id, leaseToken: lease.lease_token };
      return activeRun;
    };

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
      activeRun = await ensureSyncLease();
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
        if (activeRun) {
          await supabaseAdmin.rpc('complete_clobe_sync_run', {
            p_run_id: activeRun.runId,
            p_lease_token: activeRun.leaseToken,
            p_status: 'failed',
            p_source_count: fetched.transactions.length,
            p_error_count: 1,
            p_details: { phase: 'remote_read', failure: 'window_too_dense', next_cursor: fetched.nextCursor },
          });
          activeRun = null;
        }
        return NextResponse.json({
          success: false,
          code: 'clobe_sync_window_too_dense',
          error: `${from} ~ ${to} 기간에 ${limit}건을 초과하는 거래가 있습니다. 누락 방지를 위해 기간을 나눠 다시 동기화해주세요.`,
          mcp,
        }, { status: 409 });
      }
    }

    activeRun = await ensureSyncLease();

    const fetched = Array.isArray(rawPayload) ? rawPayload.length : 0;
    if (activeRun) {
      const { error: checkpointError } = await supabaseAdmin.rpc('checkpoint_clobe_sync_run', {
        p_run_id: activeRun.runId,
        p_lease_token: activeRun.leaseToken,
        p_cursor: mcp.nextCursor,
        p_page_count: Math.ceil(fetched / 100),
        p_details: { phase: 'reconciliation', fetched, truncated: mcp.truncated },
        p_lease_seconds: 1800,
      });
      if (checkpointError) throw checkpointError;
    }
    const normalized = normalizeClobeBankTransactions(rawPayload);
    const expectedAccount = (accountNumber ?? YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER).replace(/\D/g, '');
    const accountScopeViolations = normalized.rows.filter(row => (
      !row.accountNumber
      || row.accountNumber.replace(/\D/g, '') !== expectedAccount
    ));
    if (accountScopeViolations.length > 0) {
      throw new Error(
        `Clobe sync account mismatch: ${accountScopeViolations.length} row(s) do not belong to ${expectedAccount}`,
      );
    }
    const memoEligible = normalized.rows.filter(row => row.memo.trim().length > 0).length;
    const rawSampleKeys = normalized.rows.length === 0 ? getRawSampleKeys(rawPayload) : [];
    const result = await processBankTransactionImportRows(normalized.rows, {
      source: 'clobe_mcp',
      preview: preview || diagnosticsOnly,
      actor: 'clobe_sync',
      // A canonical Clobe travel memo creates one settlement booking keyed by
      // the normalized memo. Similar existing normal bookings remain review-
      // only inside resolveSettlementMemoBooking.
      createMissingBookings: !preview && !diagnosticsOnly,
      tenantId: settlementTenantId,
      onProgress: async (processed, total) => {
        if (!activeRun) return;
        const { error: heartbeatError } = await supabaseAdmin.rpc('checkpoint_clobe_sync_run', {
          p_run_id: activeRun.runId,
          p_lease_token: activeRun.leaseToken,
          p_cursor: mcp.nextCursor,
          p_page_count: Math.ceil(fetched / 100),
          p_details: { phase: 'reconciliation', processed, total },
          p_lease_seconds: 1800,
        });
        if (heartbeatError) throw heartbeatError;
      },
    });
    console.info('[clobe-bank-sync]', {
      from,
      to,
      limit,
      preview,
      diagnosticsOnly,
      fetched,
      normalized: normalized.rows.length,
      memoEligible,
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

    let finalSyncStatus: 'success' | 'partial' = 'success';
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

      const supplementalErrorCount = Number(Boolean(classificationRefreshError))
        + Number(Boolean(postCloseDetectionError))
        + Number(Boolean(monthlyExceptionError));
      const syncStatus = result.errors > 0 || normalized.errors.length > 0 || supplementalErrorCount > 0
        ? 'partial'
        : 'success';
      finalSyncStatus = syncStatus;
      if (!activeRun) throw new Error('Clobe sync run lease was lost before completion');
      const { error: syncRunError } = await supabaseAdmin.rpc('complete_clobe_sync_run', {
        p_run_id: activeRun.runId,
        p_lease_token: activeRun.leaseToken,
        p_status: syncStatus,
        p_source_count: fetched,
        p_recognized_count: normalized.rows.length,
        p_inserted_count: result.inserted,
        p_matched_count: result.matched,
        p_duplicate_count: result.duplicates,
        p_error_count: result.errors + normalized.errors.length + supplementalErrorCount,
        p_details: {
          tool_name: mcp.toolName,
          merged: result.merged,
          skipped: result.skipped,
          memo_updated: result.memoUpdated,
          memo_changed_review: result.memoChangedReview,
          classification_refresh: classificationRefresh,
          classification_refresh_error: classificationRefreshError,
          post_close_changes: postCloseChanges,
          post_close_detection_error: postCloseDetectionError,
          monthly_exceptions: monthlyExceptions,
          monthly_exception_error: monthlyExceptionError,
          request_started_at: syncStartedAt,
        },
      });
      if (syncRunError) throw syncRunError;
      activeRun = null;
    }

    return NextResponse.json({
      success: finalSyncStatus === 'success',
      partial: finalSyncStatus === 'partial',
      syncStatus: finalSyncStatus,
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
      memoEligible,
      normalizeErrors: normalized.errors,
      postCloseChanges,
      classificationRefresh,
      monthlyExceptions,
      ...result,
    }, { status: finalSyncStatus === 'partial' ? 207 : 200 });
  } catch (error) {
    if (activeRun) {
      const failureMessage = error instanceof Error ? error.message : 'Clobe sync failed';
      const { error: completionError } = await supabaseAdmin.rpc('complete_clobe_sync_run', {
        p_run_id: activeRun.runId,
        p_lease_token: activeRun.leaseToken,
        p_status: 'failed',
        p_error_count: 1,
        p_details: { phase: 'failed', error: failureMessage.slice(0, 500) },
      });
      if (completionError) console.error('[clobe-bank-sync] failed run completion error:', completionError.message);
    }
    Sentry.captureException(error, { tags: { area: 'clobe-bank-sync' } });
    const message = error instanceof Error ? error.message : 'Clobe sync failed';
    const status = /already running/i.test(message)
      ? 409
      : /Clobe OAuth connection|No Clobe MCP .*transaction tool|401|403/i.test(message) ? 503 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
