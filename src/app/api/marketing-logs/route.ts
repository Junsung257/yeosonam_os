/**
 * GET  /api/marketing-logs?product_id=...   — 상품별 발행 이력
 * GET  /api/marketing-logs?package_id=...   — 패키지별 발행 이력
 * GET  /api/marketing-logs?all=1            — 전체 (커버리지 집계용)
 * POST /api/marketing-logs                  — URL 검증 후 저장
 * DELETE /api/marketing-logs?id=...         — 단건 삭제
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// ─── URL 검증 ─────────────────────────────────────────────────────────────────
const URL_RE = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*)$/i;

function validateUrl(url: string): boolean {
  return URL_RE.test(url.trim());
}

// ─── 플랫폼 자동 감지 ──────────────────────────────────────────────────────────
type Platform = 'blog' | 'instagram' | 'cafe' | 'threads' | 'other';

function detectPlatform(url: string): Platform {
  const u = url.toLowerCase();
  if (/cafe\.naver\.com/.test(u))                  return 'cafe';
  if (/blog\.naver\.com|m\.blog\.naver/.test(u))   return 'blog';
  if (/naver\.com/.test(u))                         return 'blog';
  if (/instagram\.com/.test(u))                     return 'instagram';
  if (/threads\.net/.test(u))                       return 'threads';
  return 'other';
}

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const productId  = searchParams.get('product_id');
  const packageId  = searchParams.get('package_id');
  const all        = searchParams.get('all');

  let query = supabaseAdmin
    .from('marketing_logs')
    .select('id, product_id, travel_package_id, platform, url, va_id, created_at')
    .order('created_at', { ascending: false });

  if (productId)  query = query.eq('product_id', productId);
  if (packageId)  query = query.eq('travel_package_id', packageId);
  if (!productId && !packageId && !all) {
    return NextResponse.json({ error: 'product_id, package_id, 또는 all=1 파라미터가 필요합니다.' }, { status: 400 });
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data });
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { product_id, travel_package_id, platform, url, va_id } = body as {
      product_id?:        string;
      travel_package_id?: string;
      platform?:          string;
      url:                string;
      va_id?:             string;
    };

    // URL 필수 + 형식 검증
    if (!url?.trim()) {
      return NextResponse.json({ error: 'URL이 필요합니다.' }, { status: 400 });
    }
    if (!validateUrl(url.trim())) {
      return NextResponse.json(
        { error: '유효하지 않은 URL 형식입니다. (예: https://blog.naver.com/...)' },
        { status: 422 },
      );
    }

    // 플랫폼 자동 감지 (수동 입력이 없을 때)
    const resolvedPlatform: Platform =
      (platform as Platform) || detectPlatform(url.trim());

    const { data, error } = await supabaseAdmin
      .from('marketing_logs')
      .insert({
        product_id:        product_id        ?? null,
        travel_package_id: travel_package_id ?? null,
        platform:          resolvedPlatform,
        url:               url.trim(),
        va_id:             va_id             ?? null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ log: data }, { status: 201 });

  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '저장 실패' },
      { status: 500 },
    );
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('marketing_logs')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: id });
}
