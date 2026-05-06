/**
 * 여소남 OS — travel_packages.embedding 배치 백필 크론
 *
 * (URL은 "embed-products"이지만 실제 타겟은 travel_packages — 고객 응대 중심 테이블)
 *
 * 전략:
 * - embedding IS NULL AND status IN (active/approved/published) 인 패키지만 처리
 * - 배치 크기 20, 최대 10회 반복 (한 번 실행에 최대 200개)
 * - Gemini batchEmbedContents로 라운드트립 최소화
 * - Rate limit 방어: 배치간 200ms 간격
 *
 * 호출:
 *   GET /api/cron/embed-products
 *   Authorization: Bearer $CRON_SECRET (설정 시)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { embedBatch } from '@/lib/embeddings';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 20;
const MAX_ITERATIONS = 10;
const ACTIVE_STATUSES = ['active', 'approved', 'published'];

function buildEmbeddingText(p: any): string {
  const parts: string[] = [];
  if (p.title) parts.push(String(p.title));
  if (p.display_title && p.display_title !== p.title) parts.push(String(p.display_title));
  if (p.destination) parts.push(`목적지: ${p.destination}`);
  if (p.country) parts.push(`국가: ${p.country}`);
  if (p.duration) parts.push(`기간: ${p.duration}일`);
  if (p.departure_airport) parts.push(`출발공항: ${p.departure_airport}`);
  if (p.airline) parts.push(`항공사: ${p.airline}`);
  if (p.product_summary) parts.push(`요약: ${p.product_summary}`);
  if (Array.isArray(p.product_highlights) && p.product_highlights.length > 0) {
    parts.push(`특징: ${p.product_highlights.slice(0, 10).join(', ')}`);
  }
  if (Array.isArray(p.product_tags) && p.product_tags.length > 0) {
    parts.push(`태그: ${p.product_tags.slice(0, 10).join(', ')}`);
  }
  if (Array.isArray(p.inclusions) && p.inclusions.length > 0) {
    parts.push(`포함: ${p.inclusions.slice(0, 20).join(', ')}`);
  }
  if (Array.isArray(p.itinerary) && p.itinerary.length > 0) {
    parts.push(`일정: ${p.itinerary.slice(0, 10).join(' | ')}`);
  }
  if (Array.isArray(p.accommodations) && p.accommodations.length > 0) {
    parts.push(`숙소: ${p.accommodations.slice(0, 10).join(', ')}`);
  }
  if (p.raw_text) parts.push(String(p.raw_text).slice(0, 2500));
  return parts.join('\n');
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미구성' }, { status: 500 });
  }

  const apiKey = getSecret('GOOGLE_AI_API_KEY');
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_AI_API_KEY 없음' }, { status: 500 });
  }

  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  let totalEmbedded = 0;
  let totalFailed = 0;
  let iterations = 0;
  const errors: string[] = [];

  while (iterations < MAX_ITERATIONS) {
    const { data: packages, error } = await supabaseAdmin
      .from('travel_packages')
      .select(`
        id, title, display_title, destination, country, duration,
        departure_airport, airline, product_summary, product_highlights,
        product_tags, inclusions, itinerary, accommodations, raw_text
      `)
      .is('embedding', null)
      .in('status', ACTIVE_STATUSES)
      .limit(BATCH_SIZE);

    if (error) {
      errors.push(`fetch: ${error.message}`);
      break;
    }
    if (!packages || packages.length === 0) break;

    const texts = (packages as any[]).map(buildEmbeddingText);
    const embeddings = await embedBatch(texts, apiKey, 'RETRIEVAL_DOCUMENT');

    for (let i = 0; i < packages.length; i++) {
      const emb = embeddings[i];
      const pkg = packages[i] as any;
      if (!emb) {
        totalFailed++;
        continue;
      }
      const { error: updateErr } = await supabaseAdmin
        .from('travel_packages')
        .update({ embedding: emb })
        .eq('id', pkg.id);
      if (updateErr) {
        totalFailed++;
        errors.push(`update ${String(pkg.id).slice(0, 8)}: ${updateErr.message}`);
      } else {
        totalEmbedded++;
      }
    }

    iterations++;
    if (iterations < MAX_ITERATIONS) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return NextResponse.json({
    target_table: 'travel_packages',
    embedded: totalEmbedded,
    failed: totalFailed,
    iterations,
    note: iterations === MAX_ITERATIONS
      ? '최대 반복 도달 — 다시 실행 필요'
      : '완료 (처리할 행 없음)',
    errors: errors.slice(0, 5),
  });
}
