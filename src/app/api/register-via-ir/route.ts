/**
 * @file /api/register-via-ir — Phase 1.5 IR 파이프 API
 *
 * POST 본문:
 *   {
 *     rawText: string,        // 원문
 *     landOperator: string,   // "베스트아시아"
 *     commissionRate: number, // 9
 *     ticketingDeadline?: string | null,
 *     dryRun?: boolean,       // true → IR·pkg draft 만 반환, DB 저장 X
 *   }
 *
 * 응답 (dryRun=false):
 *   { ok: true, intakeId, packageId, shortCode, matchedAttractions, unmatched, noticesAuto }
 *
 * 응답 (dryRun=true):
 *   { ok: true, ir, pkg, unmatched, matchedAttractions, noticesAuto }
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { normalizeWithLlm } from '@/lib/normalize-with-llm';
import { convertIntakeToPackage, queueUnmatchedSegments } from '@/lib/ir-to-package';
import { validateIntake, NORMALIZER_VERSION, type NormalizedIntake } from '@/lib/intake-normalizer';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Normalizer LLM 이 수 십 초 걸릴 수 있음

function guessDestCode(region: string): string {
  const map: Record<string, string> = {
    '서안': 'XIY', '칭다오': 'TAO', '장가계': 'ZJJ', '나트랑': 'NHA',
    '달랏': 'DLT', '보홀': 'BHO', '후쿠오카': 'FUK', '마카오': 'MAC',
    '라오스': 'LAO', '하노이': 'HAN', '다낭': 'DAD', '캄란': 'CXR',
    '치앙마이': 'CNX', '코타키나발루': 'BKI', '푸꾸옥': 'PQC', '몽골': 'MNG',
    '방콕': 'BKK', '호치민': 'SGN', '발리': 'DPS', '세부': 'CEB',
    '황산': 'TXN', '북해도': 'CTS', '타이베이': 'TPE', '쿠알라룸푸르': 'KUL',
  };
  for (const [k, v] of Object.entries(map)) if (region.includes(k)) return v;
  return 'XXX';
}

function tiersToDatePrices(tiers: Array<Record<string, unknown>>): Array<{ date: string; price: number; confirmed: boolean }> {
  const DOW: Record<string, number> = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
  const seen = new Set<string>();
  const out: Array<{ date: string; price: number; confirmed: boolean }> = [];
  for (const t of tiers) {
    const status = t.status as string | undefined;
    if (status === 'soldout') continue;
    const confirmed = status === 'confirmed';
    const dates: string[] = [];
    const depDates = t.departure_dates as string[] | undefined;
    if (Array.isArray(depDates)) dates.push(...depDates);
    const range = t.date_range as { start?: string; end?: string } | undefined;
    const dowStr = t.departure_day_of_week as string | undefined;
    if (range?.start && range?.end && dowStr && DOW[dowStr] != null) {
      const [sy, sm, sd] = range.start.split('-').map(Number);
      const [ey, em, ed] = range.end.split('-').map(Number);
      const c = new Date(sy, sm - 1, sd);
      const end = new Date(ey, em - 1, ed);
      while (c <= end) {
        if (c.getDay() === DOW[dowStr]) {
          dates.push(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`);
        }
        c.setDate(c.getDate() + 1);
      }
    }
    for (const d of dates) {
      if (!d || seen.has(d)) continue;
      seen.add(d);
      out.push({ date: d, price: (t.adult_price as number) || 0, confirmed });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function loadOperators(): Record<string, { uuid: string; code: string }> {
  try {
    const p = path.resolve(process.cwd(), 'db', 'land-operators.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 500 });
  }

  let body: {
    rawText?: string;
    landOperator?: string;
    commissionRate?: number;
    ticketingDeadline?: string | null;
    dryRun?: boolean;
    /** Phase 1.5 — 엔진 선택: 'deepseek' (V4-Pro, 기본), 'gemini' (Flash, 폴백), 'claude' (레거시), 'direct' (이미 완성된 IR 사용) */
    engine?: 'deepseek' | 'gemini' | 'claude' | 'direct';
    /** engine=direct 일 때: Claude Code 세션·어드민이 직접 작성한 NormalizedIntake JSON */
    ir?: NormalizedIntake;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { rawText, landOperator, commissionRate, dryRun, engine, ir: providedIr } = body;

  // ── Direct 모드: 이미 작성된 IR 을 받아서 pkg 변환만 수행 (LLM 호출 0원) ──
  let ir: NormalizedIntake;
  let tokensUsed: { input: number; output: number } | undefined;
  let retryCount = 0;

  if (engine === 'direct' || providedIr) {
    if (!providedIr) {
      return NextResponse.json({ ok: false, error: 'engine=direct 시 ir 필드 필수' }, { status: 400 });
    }
    // Rule Zero: rawText·hash·version 강제 설정 (클라이언트 누락/변조 방어)
    const effectiveRaw = providedIr.rawText || rawText || '';
    if (effectiveRaw.length < 50) {
      return NextResponse.json({ ok: false, error: 'rawText 50자 이상 필수 (Rule Zero)' }, { status: 400 });
    }
    providedIr.rawText = effectiveRaw;
    providedIr.rawTextHash = crypto.createHash('sha256').update(effectiveRaw).digest('hex');
    providedIr.normalizerVersion = providedIr.normalizerVersion || `${NORMALIZER_VERSION}-direct`;
    providedIr.extractedAt = providedIr.extractedAt || new Date().toISOString();

    const validation = validateIntake(providedIr);
    if (!validation.success || !validation.data) {
      return NextResponse.json(
        {
          ok: false,
          step: 'validate-direct-ir',
          errors: validation.errors?.map((e) => `[${e.path.join('.')}] ${e.message}`) || ['unknown'],
        },
        { status: 422 },
      );
    }
    ir = validation.data;
  } else {
    // ── LLM 모드 (DeepSeek/Gemini/Claude) ──
    if (!rawText || rawText.length < 50) {
      return NextResponse.json({ ok: false, error: 'rawText 누락 또는 50자 미만 (Rule Zero)' }, { status: 400 });
    }
    if (!landOperator || commissionRate == null) {
      return NextResponse.json({ ok: false, error: 'landOperator·commissionRate 필수' }, { status: 400 });
    }

    const engineMap: Record<string, 'deepseek' | 'gemini' | 'claude'> = {
      deepseek: 'deepseek', gemini: 'gemini', claude: 'claude',
    };
    const normResult = await normalizeWithLlm({
      rawText,
      landOperator,
      commissionRate,
    }, { engine: engineMap[engine || 'deepseek'] || 'deepseek' });

    if (!normResult.success || !normResult.ir) {
      return NextResponse.json(
        { ok: false, step: 'normalize', engine: engine || 'deepseek', errors: normResult.errors, retryCount: normResult.retryCount },
        { status: 422 },
      );
    }
    ir = normResult.ir;
    tokensUsed = normResult.tokensUsed;
    retryCount = normResult.retryCount || 0;
  }

  // landOperator / commissionRate 는 INSERT 단계에서 사용 — direct 모드여도 필수
  const effectiveOperator = landOperator || ir.meta.landOperator;
  const effectiveMargin = commissionRate ?? ir.meta.commissionRate;
  if (!effectiveOperator || effectiveMargin == null) {
    return NextResponse.json({ ok: false, error: 'landOperator·commissionRate 필수 (body 또는 ir.meta 에서)' }, { status: 400 });
  }
  const effectiveRawText = ir.rawText || rawText || '';

  // 2) normalized_intakes 저장
  const rawHash = crypto.createHash('sha256').update(effectiveRawText).digest('hex');
  const { data: intakeRow, error: intakeErr } = await supabaseAdmin
    .from('normalized_intakes')
    .insert({
      raw_text: effectiveRawText,
      raw_text_hash: rawHash,
      ir,
      land_operator: effectiveOperator,
      region: ir.meta.region,
      normalizer_version: ir.normalizerVersion,
      status: dryRun ? 'draft' : 'converted',
      canary_mode: true,
    })
    .select('id')
    .single();
  if (intakeErr) {
    return NextResponse.json({ ok: false, step: 'save-intake', error: intakeErr.message }, { status: 500 });
  }
  const intakeId = intakeRow.id;

  // 3) IR → pkg 변환
  const conversion = await convertIntakeToPackage(ir, {
    sb: supabaseAdmin,
    status: 'pending',
    filename: `ir-${effectiveOperator}-${Date.now()}`,
  });

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      engine: engine || 'deepseek',
      intakeId,
      ir,
      pkg: conversion.pkg,
      matchedAttractions: conversion.matchedAttractionCount,
      unmatched: conversion.unmatchedSegments,
      noticesAuto: conversion.noticesAutoCount,
      tokensUsed,
      retryCount,
    });
  }

  // 4) 실제 INSERT
  const operators = loadOperators();
  const op = operators[effectiveOperator];
  if (!op) {
    return NextResponse.json({ ok: false, step: 'operator-lookup', error: `Unknown landOperator: ${effectiveOperator}` }, { status: 400 });
  }

  const destCode = guessDestCode(ir.meta.region);
  const { data: existing } = await supabaseAdmin
    .from('travel_packages')
    .select('short_code')
    .ilike('short_code', `${op.code}-${destCode}-%`);
  const dur = String(conversion.pkg.duration).padStart(2, '0');
  const prefix = `${op.code}-${destCode}-${dur}-`;
  const maxSeq = (existing || []).reduce((m: number, r: any) => {
    const sc = r.short_code as string;
    if (!sc?.startsWith(prefix)) return m;
    const n = parseInt(sc.split('-').pop() || '0', 10);
    return n > m ? n : m;
  }, 0);
  const shortCode = `${prefix}${String(maxSeq + 1).padStart(2, '0')}`;

  const insertPayload = {
    ...conversion.pkg,
    short_code: shortCode,
    land_operator_id: op.uuid,
    commission_rate: effectiveMargin,
    price_dates: tiersToDatePrices(conversion.pkg.price_tiers),
    baseline_requested_at: new Date().toISOString(),
  };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('travel_packages')
    .insert([insertPayload])
    .select('id, short_code, title, price')
    .single();
  if (insErr) {
    return NextResponse.json({ ok: false, step: 'insert-package', error: insErr.message }, { status: 500 });
  }

  // 5) normalized_intakes 업데이트 (package_id)
  await supabaseAdmin
    .from('normalized_intakes')
    .update({ package_id: inserted.id })
    .eq('id', intakeId);

  // 6) 미매칭 큐잉
  if (conversion.unmatchedSegments.length > 0) {
    await queueUnmatchedSegments(
      supabaseAdmin,
      intakeId,
      inserted.id,
      conversion.unmatchedSegments,
      ir.normalizerVersion,
      ir.meta.country,
      ir.meta.region,
    );
  }

  return NextResponse.json({
    ok: true,
    engine: engine || 'deepseek',
    intakeId,
    packageId: inserted.id,
    shortCode: inserted.short_code,
    title: inserted.title,
    price: inserted.price,
    matchedAttractions: conversion.matchedAttractionCount,
    unmatchedSegments: conversion.unmatchedSegments.length,
    noticesAuto: conversion.noticesAutoCount,
    tokensUsed,
    retryCount,
  });
}
