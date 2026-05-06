/**
 * @file src/app/api/card-news/generate-variants/route.ts
 *
 * Variant Generator — 한 상품 → N장 카드뉴스 변형 동시 생성.
 * AdCreative.ai / Pencil AI 의 Multi-Variant Testing 패턴.
 *
 * 작동:
 *   1. 같은 원문 + 다른 angle (luxury/value/urgency/...) 로 N번 병렬 호출
 *   2. 각 결과에 자동 사실 검증 (regex)
 *   3. 각 결과에 Cover Critic (Haiku 4.5) 자동 점수 (0-100)
 *   4. 같은 variant_group_id 로 묶어서 DB 저장
 *
 * Body:
 *   {
 *     rawText: string,
 *     productMeta?: {...},
 *     count?: number = 5,
 *     angles?: string[],     // 명시 안 하면 자동 분배
 *     toneHint?: string,
 *     package_id?: string,
 *     title?: string,
 *     skipCritic?: boolean   // critic 비용 절감 옵션
 *   }
 *
 * Response:
 *   {
 *     variant_group_id: string,
 *     variants: [
 *       { card_news_id, variant_angle, variant_score, html, faithfulness, costUsd }
 *     ],
 *     totalCostUsd: number,
 *     durationMs: number
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { executeGenerateVariantsJob, type GenerateVariantsJobPayload } from '@/lib/card-news-html/variant-job';
import { isAdminRequest } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';

export const runtime = 'nodejs';
export const maxDuration = 300; 

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const hasLlmKey = !!(
    getSecret('DEEPSEEK_API_KEY') ||
    getSecret('GEMINI_API_KEY') ||
    getSecret('GOOGLE_AI_API_KEY')
  );
  if (!hasLlmKey) {
    return NextResponse.json(
      { error: 'LLM API 키 미설정 (DEEPSEEK_API_KEY, GEMINI_API_KEY, GOOGLE_AI_API_KEY 중 하나 필요)' },
      { status: 503 },
    );
  }

  let body: GenerateVariantsJobPayload;
  try {
    body = (await request.json()) as GenerateVariantsJobPayload;
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  if (!body.rawText?.trim()) {
    return NextResponse.json({ error: 'rawText 필요' }, { status: 400 });
  }

  try {
    const result = await executeGenerateVariantsJob(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/card-news/generate-variants?group_id=...
 * 같은 그룹의 변형 목록을 조회 (variant_score 내림차순).
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const { searchParams } = request.nextUrl;
  const groupId = searchParams.get('group_id');
  if (!groupId) {
    return NextResponse.json({ error: 'group_id 필요' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('card_news')
    .select(
      'id, title, status, variant_angle, variant_score, variant_score_detail, engagement_score, is_winner, ig_publish_status, ig_slide_urls, html_generated, html_usage, created_at',
    )
    .eq('variant_group_id', groupId)
    .order('variant_score', { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ group_id: groupId, variants: data ?? [] });
}
