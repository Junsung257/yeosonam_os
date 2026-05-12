/**
 * POST /api/tracking/guidebook
 *
 * 모바일 가이드북에서 길찾기·예약·바우처 열기 등 행동 로그 (guidebook_events).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { allowRateLimit, getClientIpFromRequest } from '@/lib/simple-rate-limit';

export const runtime = 'nodejs';

/** IP당 분당 / IP+가이드당 분당 (과도한 스팸 방지) */
const LIMIT_PER_IP_PER_MIN = 96;
const LIMIT_PER_IP_GUIDE_PER_MIN = 48;

const ACTIONS = new Set([
  'guide_open',
  'voucher_open',
  'directions_hotel',
  'book_hotel',
  'directions_activity',
  'book_activity',
]);

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ skipped: true }, { status: 202 });
  try {
    const body = (await req.json()) as {
      guide_ref?: string;
      action?: string;
      meta?: Record<string, unknown>;
    };
    const guideRef = String(body.guide_ref ?? '').trim();
    const action = String(body.action ?? '').trim();
    if (!guideRef || guideRef.length < 8 || guideRef.length > 64) {
      return NextResponse.json({ error: 'guide_ref invalid' }, { status: 400 });
    }
    if (!ACTIONS.has(action)) {
      return NextResponse.json({ error: 'action invalid' }, { status: 400 });
    }

    const ip = getClientIpFromRequest(req);
    if (!allowRateLimit(`guidebook:ip:${ip}`, LIMIT_PER_IP_PER_MIN)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    if (!allowRateLimit(`guidebook:ip:${ip}:ref:${guideRef}`, LIMIT_PER_IP_GUIDE_PER_MIN)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const meta =
      body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)
        ? body.meta
        : {};

    const { error } = await supabaseAdmin.from('guidebook_events').insert({
      guide_ref: guideRef,
      action,
      meta,
    } as never);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[guidebook tracking]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
