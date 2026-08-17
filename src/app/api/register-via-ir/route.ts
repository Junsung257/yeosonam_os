/**
 * IR is an intake adapter only. It may preview a candidate interpretation, but
 * every persisted product must enter the same source-backed Registration
 * Kernel workflow as /api/upload.
 */
import crypto from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { convertIntakeToPackage } from '@/lib/ir-to-package';
import {
  NORMALIZER_VERSION,
  type NormalizedIntake,
  validateIntake,
} from '@/lib/intake-normalizer';
import { getIrCanaryStatus } from '@/lib/ir-canary';
import { normalizeWithLlm } from '@/lib/normalize-with-llm';
import { isSynthesizedRawText } from '@/lib/packages/raw-text';
import { startProductRegistrationTextWorkflow } from '@/lib/product-registration-authority/start-workflow';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE } from '@/lib/upload-source-metadata';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type RequestBody = {
  rawText?: string;
  landOperator?: string;
  commissionRate?: number;
  ticketingDeadline?: string | null;
  dryRun?: boolean;
  engine?: 'deepseek' | 'direct';
  ir?: NormalizedIntake;
};

function sourceEvidence(body: RequestBody): string {
  return String(body.ir?.rawText || body.rawText || '').trim();
}

function validateSourceText(rawText: string): NextResponse | null {
  if (rawText.length < 50) {
    return NextResponse.json({
      ok: false,
      code: 'IR_SOURCE_EVIDENCE_REQUIRED',
      error: '통합 등록에는 50자 이상의 실제 원문이 필요합니다.',
    }, { status: 422 });
  }
  if (isSynthesizedRawText(rawText)) {
    return NextResponse.json({
      ok: false,
      code: 'IR_SYNTHESIZED_SOURCE_FORBIDDEN',
      error: '합성 문구는 상품 사실의 증거로 사용할 수 없습니다.',
    }, { status: 422 });
  }
  return null;
}

async function buildPreview(body: RequestBody, rawText: string) {
  let ir: NormalizedIntake;
  let tokensUsed: { input: number; output: number } | undefined;
  let retryCount = 0;
  let resolvedEngine: 'deepseek' | 'direct' = body.engine ?? 'deepseek';

  if (body.engine === 'direct' || body.ir) {
    if (!body.ir) throw new Error('IR_DIRECT_PAYLOAD_REQUIRED');
    const candidate: NormalizedIntake = {
      ...body.ir,
      rawText,
      rawTextHash: crypto.createHash('sha256').update(rawText).digest('hex'),
      normalizerVersion: body.ir.normalizerVersion || `${NORMALIZER_VERSION}-direct`,
      extractedAt: body.ir.extractedAt || new Date().toISOString(),
    };
    const validation = validateIntake(candidate);
    if (!validation.success || !validation.data) {
      return NextResponse.json({
        ok: false,
        step: 'validate-direct-ir',
        errors: validation.errors?.map(error => `[${error.path.join('.')}] ${error.message}`) ?? ['unknown'],
      }, { status: 422 });
    }
    ir = validation.data;
    resolvedEngine = 'direct';
  } else {
    const landOperator = body.landOperator?.trim() || '미확인 랜드사';
    const commissionRate = Number.isFinite(Number(body.commissionRate))
      ? Number(body.commissionRate)
      : DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE;
    resolvedEngine = 'deepseek';
    const normalized = await normalizeWithLlm({ rawText, landOperator, commissionRate }, {
      engine: 'deepseek',
    });
    if (!normalized.success || !normalized.ir) {
      return NextResponse.json({
        ok: false,
        step: 'normalize-preview',
        engine: resolvedEngine,
        errors: normalized.errors,
        retryCount: normalized.retryCount,
        canary: getIrCanaryStatus(),
      }, { status: 422 });
    }
    ir = normalized.ir;
    tokensUsed = normalized.tokensUsed;
    retryCount = normalized.retryCount ?? 0;
  }

  const conversion = await convertIntakeToPackage(ir, {
    sb: supabaseAdmin,
    status: 'pending',
    filename: `ir-preview-${Date.now()}`,
  });
  return NextResponse.json({
    ok: true,
    dryRun: true,
    persisted: false,
    engine: resolvedEngine,
    canary: getIrCanaryStatus(),
    ir,
    pkg: conversion.pkg,
    matchedAttractions: conversion.matchedAttractionCount,
    unmatched: conversion.unmatchedSegments,
    noticesAuto: conversion.noticesAutoCount,
    tokensUsed,
    retryCount,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const rawText = sourceEvidence(body);
  if (body.engine && body.engine !== 'deepseek' && body.engine !== 'direct') {
    return NextResponse.json({
      ok: false,
      code: 'PRODUCT_REGISTRATION_DEEPSEEK_ONLY',
      error: '상품등록 AI 엔진은 DeepSeek만 사용할 수 있습니다.',
    }, { status: 422 });
  }
  const sourceError = validateSourceText(rawText);
  if (sourceError) return sourceError;
  if (body.dryRun) return buildPreview(body, rawText);

  const runtime = getProductRegistrationV6RuntimeConfig();
  if (!runtime.workflowEnabled) {
    return NextResponse.json({
      ok: false,
      code: 'REGISTRATION_KERNEL_WORKFLOW_DISABLED',
      error: '통합 등록 workflow가 비활성화되어 저장하지 않았습니다.',
    }, { status: 503 });
  }

  const landOperator = body.landOperator?.trim() || body.ir?.meta?.landOperator?.trim() || '미확인 랜드사';
  const commissionRate = Number.isFinite(Number(body.commissionRate ?? body.ir?.meta?.commissionRate))
    ? Number(body.commissionRate ?? body.ir?.meta?.commissionRate)
    : DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE;
  const requestId = crypto.randomUUID();
  const started = await startProductRegistrationTextWorkflow({
    supabase: supabaseAdmin,
    tenantId: PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
    rawText,
    fileName: `ir-${landOperator}-${Date.now()}.txt`,
    requestId,
    requestBaseUrl: req.nextUrl.origin,
    publicBaseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin,
    sourceChannel: 'ir',
    uploadSourceMetadata: {
      landOperator,
      commissionRate,
      marginRate: commissionRate,
      ticketingDeadline: body.ticketingDeadline ?? null,
      source: body.landOperator ? 'explicit' : 'inferred_unknown',
      issues: body.landOperator ? [] : ['LAND_OPERATOR_UNCONFIRMED'],
    },
    metadata: {
      providedIrHash: body.ir?.rawTextHash ?? null,
      providedIrVersion: body.ir?.normalizerVersion ?? null,
      providedIrIsCandidateOnly: Boolean(body.ir),
    },
    forceReprocess: false,
  });

  return NextResponse.json({
    ok: true,
    code: 'PRODUCT_REGISTRATION_KERNEL_ACCEPTED',
    state: 'processing',
    sourceChannel: 'ir',
    commissionRate,
    ...started,
  }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}
