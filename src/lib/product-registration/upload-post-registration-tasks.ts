import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { runAutoMobileQA } from '@/lib/auto-mobile-qa';
import { runAutoPhotoMatch } from '@/lib/auto-photo-match';
import { runCoVeInBackground } from '@/lib/cove-audit-bridge';
import { getIrCanaryStatus } from '@/lib/ir-canary';
import { accumulateLandOperatorProfile } from '@/lib/land-operator-profile';
import { persistIntakeSnapshot } from '@/lib/persist-intake-snapshot';
import { runUploadIrShadowIfSampled } from '@/lib/upload-ir-shadow';
import { runUploadVerify } from '@/lib/upload-verify';
import { persistProductRegistrationDraftV3, runProductRegistrationV3 } from '@/lib/product-registration-v3';
import type { AttractionData } from '@/lib/attraction-matcher';
import type { AlertInput } from '@/lib/admin-alerts';
import type { LeakIncident } from '@/lib/customer-leak-sanitizer';

export type UploadSafeAfter = (task: () => Promise<void> | void) => void;

type PostAlert = (input: AlertInput) => Promise<unknown> | unknown;

export async function recordUploadAiQualityLog(input: {
  supabase: SupabaseClient;
  packageId: string;
  internalCode: string | null;
  confidence: number;
  fillScore: number;
  crossValidationScore: number;
  leakScore: number;
  autoGate: string;
  failedChecks: unknown[];
  leakIncidents: LeakIncident[];
  llmMeta: Record<string, unknown>;
  attractionMatchedCount: number;
  attractionUnmatchedCount: number;
}): Promise<void> {
  const { error } = await input.supabase
    .from('ai_quality_log')
    .insert({
      package_id: input.packageId,
      internal_code: input.internalCode,
      confidence: input.confidence,
      fill_score: input.fillScore,
      xvalid_score: input.crossValidationScore,
      leak_score: input.leakScore,
      auto_gate: input.autoGate,
      failed_checks: input.failedChecks,
      leak_incidents: input.leakIncidents,
      advisor_escalated: Boolean(input.llmMeta.advisor_used),
      llm_providers: input.llmMeta.provider ? [String(input.llmMeta.provider)] : [],
      llm_tokens_input: Number(input.llmMeta.tokens_input ?? 0),
      llm_tokens_output: Number(input.llmMeta.tokens_output ?? 0),
      llm_calls_count: 1 + (input.llmMeta.advisor_used ? 1 : 0),
      section_cache_hit_count: Number(input.llmMeta.section_cache_hit_count ?? 0),
      section_cache_reduced_chars: Number(input.llmMeta.section_cache_reduced_chars ?? 0),
      section_cache_reduce_ready: Boolean(input.llmMeta.section_cache_reduce_ready),
      section_cache_replaced_labels: Array.isArray(input.llmMeta.section_cache_replaced_labels)
        ? input.llmMeta.section_cache_replaced_labels.map(String)
        : [],
      attraction_matched_count: input.attractionMatchedCount,
      attraction_unmatched_count: input.attractionUnmatchedCount,
      attraction_seeded_count: 0,
      attraction_reflected_count: 0,
    });

  if (error) console.warn('[Upload API] ai_quality_log insert failed:', error.message);
}

export async function logUploadPostSaveAuditStatus(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  packageId: string | null | undefined;
}): Promise<void> {
  if (!input.packageId || !input.isSupabaseConfigured) return;

  try {
    const { data: check } = await input.supabase
      .from('travel_packages')
      .select('audit_status, status')
      .eq('id', input.packageId)
      .single();
    if (check && (check.audit_status === 'clean' || check.audit_status === 'info') && check.status !== 'active') {
      console.log(`[Upload API] audit_status=${check.audit_status} -> auto activation held for admin approval: ${input.packageId}`);
    }
  } catch {
    // Fail-soft: background audits may finish later.
  }
}

export function scheduleUploadPostRegistrationTasks(input: {
  safeAfter: UploadSafeAfter;
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  postAlert: PostAlert;
  packageId: string;
  packageTitle: string;
  packageRow: Record<string, unknown>;
  internalCode: string | null;
  destination: string | null;
  sourceType: string | null;
  activeAttractions: AttractionData[];
  rawText: string;
  documentRawText: string;
  landOperatorName: string;
  landOperatorId: string | null;
  commissionRate: number;
  confidence: number;
  rejected: boolean;
  leakIncidents: LeakIncident[];
  irCanaryPrimary: boolean;
  auditBaseUrl: string;
}): void {
  const rawTextHash = createHash('sha256').update(input.rawText).digest('hex');

  input.safeAfter(async () => {
    try {
      const v3 = await runProductRegistrationV3(input.rawText, {
        attractions: input.activeAttractions,
        destination: input.destination,
        supplierHint: input.landOperatorName,
        sourceType: input.sourceType,
      });
      const persisted = await persistProductRegistrationDraftV3(input.supabase, {
        packageId: input.packageId,
        packageTitle: input.packageTitle,
        rawText: input.rawText,
        sourceType: input.sourceType,
        supplierHint: input.landOperatorName,
        destination: input.destination,
        documentType: v3.structure_plan.document_type,
        result: v3,
      });
      if (persisted.error) {
        console.warn('[upload-after] product_registration_drafts V3 save failed:', persisted.error);
      } else {
        console.log('[upload-after] product_registration_drafts V3:', persisted.id, v3.gate_result.status, `queued=${persisted.queuedUnmatched}`);
      }
    } catch (e) {
      console.warn('[upload-after] product-registration-v3 sidecar failed:', e instanceof Error ? e.message : e);
    }
  });

  input.safeAfter(async () => {
    try {
      await Promise.allSettled([
        runCoVeInBackground(input.packageId),
        runUploadVerify(input.packageId),
        runAutoMobileQA(input.packageId, input.auditBaseUrl),
      ]);
    } catch (e) {
      console.warn('[upload-after] post-audit bundle failed:', e instanceof Error ? e.message : e);
    }
  });

  if (input.isSupabaseConfigured) {
    input.safeAfter(async () => {
      try {
        const snap = await persistIntakeSnapshot(input.supabase, {
          packageId: input.packageId,
          pkg: input.packageRow,
          landOperatorName: input.landOperatorName,
          source: 'upload',
        });
        if (snap.warnings.length > 0) {
          console.log('[upload-after] intake snapshot:', snap.intakeId ?? 'skip', snap.warnings.slice(0, 2).join('; '));
        }
        if (input.rawText.length >= 50 && input.landOperatorName !== '(unknown)' && !input.irCanaryPrimary) {
          const shadow = await runUploadIrShadowIfSampled(input.supabase, {
            rawText: input.rawText,
            rawTextHash,
            packageId: input.packageId,
            landOperator: input.landOperatorName,
            commissionRate: input.commissionRate,
          });
          if (shadow.sampled && getIrCanaryStatus().enabled) {
            console.log('[upload-after] IR canary shadow:', shadow.intakeId ?? shadow.errors?.[0] ?? 'ok');
          }
        }
      } catch (e) {
        console.warn('[upload-after] intake snapshot failed:', e instanceof Error ? e.message : e);
      }
    });
  }

  if (input.landOperatorId) {
    input.safeAfter(async () => {
      try {
        await accumulateLandOperatorProfile({
          landOperatorId: input.landOperatorId as string,
          rawText: input.documentRawText,
          confidence: input.confidence,
          rejected: input.rejected,
          detectedB2bTerms: input.leakIncidents
            .filter(incident => incident.severity !== 'medium')
            .map(incident => incident.matched),
        });
      } catch (e) {
        console.warn('[upload-after] land-operator profile failed:', e instanceof Error ? e.message : e);
      }
    });
  }

  if (input.internalCode) {
    input.safeAfter(async () => {
      try {
        await runAutoPhotoMatch({
          internalCode: input.internalCode as string,
          destination: input.destination,
          title: input.packageTitle,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[Upload API] autoPhotoMatch failed:', msg);
        if (input.isSupabaseConfigured) {
          void input.postAlert({
            category: 'register-backfill',
            severity: 'warning',
            title: `autoPhotoMatch failed: ${input.internalCode}`,
            message: msg.slice(0, 500),
            ref_type: 'travel_package',
            ref_id: input.packageId,
            meta: { phase: 'auto-photo-match', error: msg.slice(0, 500) },
            dedupe: true,
          });
        }
      }
    });
  }
}

export function scheduleUploadL3BackfillTasks(input: {
  safeAfter: UploadSafeAfter;
  packageIds: string[];
  isSupabaseConfigured: boolean;
  postAlert: PostAlert;
}): void {
  for (const packageId of input.packageIds) {
    input.safeAfter(async () => {
      try {
        const { backfillPackageAttractionsL3 } = await import('@/lib/itinerary-llm-extractor');
        const result = await backfillPackageAttractionsL3(packageId, { skipIfMatchRateAbove: 0.9 });
        if (result.ok) {
          console.log(
            `[Upload API] L3 attractions: ${packageId.slice(0, 8)} ${((result.before ?? 0) * 100).toFixed(0)}% -> ${((result.after ?? 0) * 100).toFixed(0)}%`,
          );
        } else {
          console.warn(`[Upload API] L3 attractions skip/fail: ${packageId.slice(0, 8)} -> ${result.reason}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[Upload API] L3 attractions failed:', msg);
        if (input.isSupabaseConfigured) {
          void input.postAlert({
            category: 'register-backfill',
            severity: 'warning',
            title: `attractions backfill failed: ${packageId.slice(0, 8)}`,
            message: msg.slice(0, 500),
            ref_type: 'travel_package',
            ref_id: packageId,
            meta: { phase: 'attractions', error: msg.slice(0, 500) },
            dedupe: true,
          });
        }
      }

      try {
        const { backfillSectionsByPackageId } = await import('@/lib/parser/llm/section-extractors');
        const result = await backfillSectionsByPackageId(packageId, { force: false });
        console.log(
          `[Upload API] L3 sections: ${packageId.slice(0, 8)} hero=${result.hero?.applied} price=${result.price?.applied}(${result.price?.rowCount ?? 0}) notices=${result.notices?.applied}`,
        );
        if ((!result.hero?.applied || !result.price?.applied) && input.isSupabaseConfigured) {
          void input.postAlert({
            category: 'register-backfill',
            severity: 'warning',
            title: `sections backfill partial failure: ${packageId.slice(0, 8)}`,
            message: `hero=${result.hero?.applied} price=${result.price?.applied}(${result.price?.rowCount ?? 0})`,
            ref_type: 'travel_package',
            ref_id: packageId,
            meta: { phase: 'sections', hero: result.hero, price: result.price, notices: result.notices },
            dedupe: true,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[Upload API] L3 sections failed:', msg);
        if (input.isSupabaseConfigured) {
          void input.postAlert({
            category: 'register-backfill',
            severity: 'warning',
            title: `sections backfill failed: ${packageId.slice(0, 8)}`,
            message: msg.slice(0, 500),
            ref_type: 'travel_package',
            ref_id: packageId,
            meta: { phase: 'sections', error: msg.slice(0, 500) },
            dedupe: true,
          });
        }
      }
    });
  }
}
