/**
 * Phase 2-G: 어드민 B2B API 키 관리
 * GET  /api/admin/b2b/keys   → 전체 키 목록 (key_hash 앞 8자만 표시)
 * POST /api/admin/b2b/keys   → 새 키 발급 (UUID v4 raw key → hash 저장, raw 1회 응답)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

async function requireAdmin(request: NextRequest): Promise<string | null> {
  const token =
    request.cookies.get('sb-access-token')?.value ??
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: userData } = await supabaseAdmin.auth.getUser(token ?? '');
  return userData?.user?.id ?? null;
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

// ─── GET: 키 목록 ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ data: [] });
  }

  const userId = await requireAdmin(request);
  if (!userId) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('b2b_api_keys')
      .select(
        'id, label, is_active, rate_limit_per_hour, allowed_ips, created_at, last_used_at, total_calls, key_hash',
      )
      .order('created_at', { ascending: false });

    if (error) throw error;

    // key_hash 앞 8자만 노출 (보안: 전체 hash 노출 금지)
    const masked = (data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      key_hash: `${(row.key_hash as string).slice(0, 8)}...`,
    }));

    return NextResponse.json({ data: masked });
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST: 새 키 발급 ────────────────────────────────────────

interface KeyCreateBody {
  label: string;
  rate_limit_per_hour?: number;
  allowed_ips?: string[];
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const userId = await requireAdmin(request);
  if (!userId) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  let body: KeyCreateBody;
  try {
    body = await request.json() as KeyCreateBody;
  } catch {
    return NextResponse.json({ error: '유효하지 않은 JSON 본문' }, { status: 400 });
  }

  if (!body.label || typeof body.label !== 'string' || body.label.trim().length === 0) {
    return NextResponse.json({ error: 'label은 필수입니다' }, { status: 400 });
  }

  // raw key 생성 (UUID v4 — 충분한 엔트로피)
  const rawKey = randomUUID();
  const keyHash = hashKey(rawKey);

  try {
    const { data, error } = await supabaseAdmin
      .from('b2b_api_keys')
      .insert({
        key_hash: keyHash,
        label: body.label.trim(),
        rate_limit_per_hour: body.rate_limit_per_hour ?? 100,
        allowed_ips: body.allowed_ips ?? null,
      })
      .select('id, label, is_active, rate_limit_per_hour, allowed_ips, created_at')
      .single();

    if (error) throw error;

    // raw key는 이 응답에서 딱 1회만 반환 — 다시 조회 불가
    return NextResponse.json(
      {
        ok: true,
        raw_key: rawKey,
        note: '이 키는 지금만 확인 가능합니다. 반드시 안전한 곳에 보관하세요.',
        key: data,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
