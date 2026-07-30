import { generateContentBrief } from '@/lib/content-pipeline/content-brief';
import { generateThreadsPost } from '@/lib/content-pipeline/agents/threads-post';
import { loadPublicContentPackageForGeneration } from '@/lib/content-public-package';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { loadCustomerOpenContractForPackage } from '@/lib/product-registration/customer-open-contract';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';

const GENERATION_AGENT = 'threads-full-autopilot-v1';
const RECENT_PRODUCT_WINDOW_DAYS = 14;
const GENERATION_ACTION_TYPE = 'threads_content_generate';
const GENERATION_LEASE_MS = 15 * 60 * 1000;

export interface ThreadsContentAutopilotSummary {
  [key: string]: unknown;
  ok: boolean;
  enabled: boolean;
  generated: number;
  productId?: string;
  distributionId?: string;
  skippedReason?: string;
  errors: string[];
}

function startOfKstDayIso(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

function kstDateKey(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function claimDailyGeneration(): Promise<string | null> {
  const idempotencyKey = `threads_content_autopilot:${kstDateKey()}`;
  const leaseUntil = new Date(Date.now() + GENERATION_LEASE_MS).toISOString();
  const payload = { autopilot_day: kstDateKey(), attempt: 1 };
  const { data, error } = await supabaseAdmin
    .from('agent_actions')
    .insert({
      agent_type: 'marketing',
      action_type: GENERATION_ACTION_TYPE,
      summary: 'Threads 일일 콘텐츠 자동 생성',
      payload,
      status: 'executing',
      priority: 'normal',
      requested_by: 'threads-content-autopilot-cron',
      idempotency_key: idempotencyKey,
      expires_at: leaseUntil,
    } as never)
    .select('id')
    .maybeSingle();

  if (!error) return data?.id ?? null;
  if ((error as { code?: string }).code !== '23505') throw error;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('agent_actions')
    .select('id, status, expires_at, payload')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing?.id) return null;

  const leaseExpired =
    existing.status === 'executing' &&
    (!existing.expires_at || new Date(existing.expires_at).getTime() <= Date.now());
  if (existing.status !== 'failed' && !leaseExpired) return null;

  const currentPayload =
    existing.payload && typeof existing.payload === 'object' && !Array.isArray(existing.payload)
      ? existing.payload as Record<string, unknown>
      : {};
  const attempt = Number(currentPayload.attempt ?? 1) + 1;
  if (attempt > 3) return null;

  let retry = supabaseAdmin
    .from('agent_actions')
    .update({
      status: 'executing',
      payload: { ...currentPayload, attempt },
      result_log: null,
      reject_reason: null,
      resolved_at: null,
      expires_at: leaseUntil,
    } as never)
    .eq('id', existing.id)
    .eq('status', existing.status);
  if (existing.status === 'executing' && existing.expires_at) {
    retry = retry.lte('expires_at', new Date().toISOString());
  }
  const { data: retried, error: retryError } = await retry.select('id').maybeSingle();
  if (retryError) throw retryError;
  return retried?.id ?? null;
}

async function finishDailyGeneration(
  actionId: string,
  status: 'executed' | 'failed',
  result: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('agent_actions')
    .update({
      status,
      result_log: JSON.stringify({ success: status === 'executed', ...result }),
      reject_reason: status === 'failed' ? String(result.error ?? 'generation_failed') : null,
      resolved_at: new Date().toISOString(),
      expires_at: null,
    } as never)
    .eq('id', actionId);
  if (error) throw error;
}

export async function runThreadsContentAutopilot(): Promise<ThreadsContentAutopilotSummary> {
  const summary: ThreadsContentAutopilotSummary = {
    ok: true,
    enabled: false,
    generated: 0,
    errors: [],
  };
  if (!isSupabaseAdminConfigured) {
    return { ...summary, ok: false, skippedReason: 'admin_database_not_configured' };
  }

  let generationActionId: string | null = null;
  try {
    const { data: platform, error: platformError } = await supabaseAdmin
      .from('social_platform_configs')
      .select('enabled')
      .eq('platform', 'threads')
      .maybeSingle();
    if (platformError) throw platformError;
    summary.enabled = platform?.enabled === true;
    if (!summary.enabled) {
      summary.skippedReason = 'threads_platform_disabled';
      return summary;
    }

    const { data: generatedToday, error: generatedTodayError } = await supabaseAdmin
      .from('content_distributions')
      .select('id')
      .eq('platform', 'threads_post')
      .eq('generation_agent', GENERATION_AGENT)
      .gte('created_at', startOfKstDayIso())
      .limit(1);
    if (generatedTodayError) throw generatedTodayError;
    if (generatedToday?.length) {
      summary.skippedReason = 'already_generated_today';
      return summary;
    }

    generationActionId = await claimDailyGeneration();
    if (!generationActionId) {
      summary.skippedReason = 'generation_already_claimed_today';
      return summary;
    }

    const recentSince = new Date(
      Date.now() - RECENT_PRODUCT_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    const [{ data: packages, error: packageError }, { data: recent, error: recentError }] =
      await Promise.all([
        supabaseAdmin
          .from('travel_packages')
          .select('id')
          .eq('is_active', true)
          .eq('is_approved', true)
          .in('publication_state', ['approved', 'published'])
          .order('updated_at', { ascending: false })
          .limit(20),
        supabaseAdmin
          .from('content_distributions')
          .select('product_id')
          .eq('platform', 'threads_post')
          .gte('created_at', recentSince)
          .not('product_id', 'is', null),
      ]);
    if (packageError) throw packageError;
    if (recentError) throw recentError;

    const recentIds = new Set((recent ?? []).map((row) => row.product_id).filter(Boolean));
    const orderedCandidates = [
      ...(packages ?? []).filter((row) => !recentIds.has(row.id)),
      ...(packages ?? []).filter((row) => recentIds.has(row.id)),
    ];

    for (const candidate of orderedCandidates) {
      const product = await loadPublicContentPackageForGeneration(candidate.id);
      if (!product?.destination) continue;
      const openContract = await loadCustomerOpenContractForPackage(
        supabaseAdmin,
        candidate.id,
      );
      if (!openContract.ok) continue;

      const productInput = {
        title: product.title,
        destination: product.destination,
        duration: product.duration,
        nights: product.nights,
        price: product.price,
        airline: product.airline,
        departure_airport: product.departure_airport,
        inclusions: product.inclusions,
        product_highlights: product.product_highlights,
        itinerary: product.itinerary,
        product_summary: product.product_summary,
      };
      const brief = await generateContentBrief({
        mode: 'product',
        slideCount: 6,
        tone: 'friendly_expert',
        product: productInput,
      });
      const post = await generateThreadsPost({
        brief,
        product: productInput,
        candidateCount: 3,
      });

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('content_distributions')
        .insert({
          product_id: candidate.id,
          platform: 'threads_post',
          status: 'draft',
          payload: {
            ...post,
            generated_at: new Date().toISOString(),
            source: 'threads_full_autopilot',
          },
          generation_agent: GENERATION_AGENT,
          generation_config: {
            mode: 'product_rotation',
            trend_learning: true,
            recent_product_window_days: RECENT_PRODUCT_WINDOW_DAYS,
            brief,
          },
        } as never)
        .select('id')
        .single();
      if (insertError) throw insertError;

      summary.generated = 1;
      summary.productId = candidate.id;
      summary.distributionId = inserted.id;
      await finishDailyGeneration(generationActionId, 'executed', {
        distribution_id: inserted.id,
        product_id: candidate.id,
      });
      return summary;
    }

    summary.skippedReason = 'no_customer_open_product_candidate';
    await finishDailyGeneration(generationActionId, 'executed', {
      skipped_reason: summary.skippedReason,
    });
    return summary;
  } catch (error) {
    summary.ok = false;
    const message = sanitizeDbError(error, 'Threads content autopilot failed');
    summary.errors.push(message);
    if (generationActionId) {
      try {
        await finishDailyGeneration(generationActionId, 'failed', { error: message });
      } catch (auditError) {
        summary.errors.push(sanitizeDbError(auditError, 'Threads generation audit failed'));
      }
    }
    return summary;
  }
}
