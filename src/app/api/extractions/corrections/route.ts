/**
 * /api/extractions/corrections — Reflexion 정정 메모리 API
 *
 * Shinn et al. NeurIPS 2023 (arXiv 2303.11366) 패턴:
 *   - 정정 = 사장님의 자연어 피드백 (Evaluator + Self-Reflection)
 *   - 누적된 reflection 을 동일 랜드사·지역 다음 등록 prompt 에 자동 주입
 *
 * POST: 정정 기록
 * GET:  활성 reflection 조회 (랜드사 + 지역 필터)
 * PATCH: is_active 토글 또는 reflection 텍스트 수정
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

interface CorrectionInput {
  package_id?: string;
  land_operator_id?: string;
  destination?: string;
  field_path: string;
  before_value?: unknown;
  after_value?: unknown;
  reflection?: string;
  raw_text_excerpt?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  category?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  POST — 정정 기록
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const body = (await request.json()) as CorrectionInput | { items: CorrectionInput[] };
    const items: CorrectionInput[] = Array.isArray((body as { items?: CorrectionInput[] }).items)
      ? (body as { items: CorrectionInput[] }).items
      : [body as CorrectionInput];

    const valid = items.filter(item => item && typeof item.field_path === 'string' && item.field_path.length > 0);
    if (valid.length === 0) {
      return NextResponse.json({ error: 'field_path 필수' }, { status: 400 });
    }

    // package_id 있을 경우 land_operator_id + destination 자동 보강
    for (const item of valid) {
      if (item.package_id && (!item.land_operator_id || !item.destination)) {
        const { data: pkg } = await supabaseAdmin
          .from('travel_packages')
          .select('land_operator_id, destination')
          .eq('id', item.package_id)
          .limit(1);
        if (pkg?.[0]) {
          if (!item.land_operator_id) item.land_operator_id = pkg[0].land_operator_id;
          if (!item.destination) item.destination = pkg[0].destination;
        }
      }
    }

    const rows = valid.map(item => ({
      package_id: item.package_id || null,
      land_operator_id: item.land_operator_id || null,
      destination: item.destination || null,
      field_path: item.field_path,
      before_value: item.before_value ?? null,
      after_value: item.after_value ?? null,
      reflection: item.reflection || null,
      raw_text_excerpt: item.raw_text_excerpt || null,
      severity: item.severity || 'medium',
      category: item.category || null,
    }));

    const { data, error } = await supabaseAdmin
      .from('extractions_corrections')
      .insert(rows)
      .select('id');

    if (error) throw error;

    return NextResponse.json({
      success: true,
      saved: data?.length || 0,
      ids: (data || []).map((r: { id: string }) => r.id),
    });
  } catch (err) {
    console.error('[corrections POST]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '저장 실패' }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  GET — 활성 reflection 조회 (normalize-with-llm 이 호출)
//  + ?stats=field|category|destination — 시스템 약점 자동 발견 통계
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ corrections: [] });

  try {
    const { searchParams } = new URL(request.url);
    const stats = searchParams.get('stats');

    // ── 통계 분기 ─────────────────────────────────────────
    if (stats === 'field') {
      const dest = searchParams.get('destination');
      const minSev = searchParams.get('min_severity') || 'low';
      const { data, error } = await supabaseAdmin.rpc('corrections_stats_by_field', {
        p_destination: dest || null,
        p_min_severity: minSev,
      });
      if (error) throw error;
      return NextResponse.json({ stats: 'field', rows: data || [] });
    }
    if (stats === 'category') {
      const { data, error } = await supabaseAdmin.rpc('corrections_stats_by_category');
      if (error) throw error;
      return NextResponse.json({ stats: 'category', rows: data || [] });
    }
    if (stats === 'destination') {
      const { data, error } = await supabaseAdmin.rpc('corrections_stats_by_destination');
      if (error) throw error;
      return NextResponse.json({ stats: 'destination', rows: data || [] });
    }

    const landOperatorId = searchParams.get('land_operator_id');
    const destination = searchParams.get('destination');
    const limit = Number(searchParams.get('limit') || 8);
    const minSeverity = searchParams.get('min_severity') || 'low';

    const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };
    const minRank = SEVERITY_ORDER[minSeverity as keyof typeof SEVERITY_ORDER] || 1;

    let query = supabaseAdmin
      .from('extractions_corrections')
      .select('id, field_path, reflection, before_value, after_value, raw_text_excerpt, severity, category, created_at, applied_count, land_operator_id, destination')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(1, limit), 50));

    // 우선순위:
    //   1. 동일 랜드사 + 동일 지역
    //   2. 동일 지역 (다른 랜드사)
    //   3. 동일 랜드사 (다른 지역)
    if (landOperatorId && destination) {
      query = query.or(`and(land_operator_id.eq.${landOperatorId},destination.eq.${destination}),and(destination.eq.${destination}),and(land_operator_id.eq.${landOperatorId})`);
    } else if (destination) {
      query = query.eq('destination', destination);
    } else if (landOperatorId) {
      query = query.eq('land_operator_id', landOperatorId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const filtered = (data || []).filter((c: { severity?: string }) => {
      const rank = SEVERITY_ORDER[c.severity as keyof typeof SEVERITY_ORDER] || 1;
      return rank >= minRank;
    });

    return NextResponse.json({ corrections: filtered });
  } catch (err) {
    console.error('[corrections GET]', err);
    return NextResponse.json({ corrections: [] });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  GET 분기: ?stats=field|category|destination — 시스템 약점 자동 발견
// ═══════════════════════════════════════════════════════════════════════════
// 위 GET 위에 추가 분기 처리 (별도 함수)

// ═══════════════════════════════════════════════════════════════════════════
//  PATCH — is_active 토글 또는 reflection 수정
// ═══════════════════════════════════════════════════════════════════════════
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const body = await request.json();
    const { id, is_active, reflection, severity, category } = body;
    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (typeof is_active === 'boolean') updates.is_active = is_active;
    if (typeof reflection === 'string') updates.reflection = reflection;
    if (typeof severity === 'string') updates.severity = severity;
    if (typeof category === 'string') updates.category = category;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '변경할 필드 없음' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('extractions_corrections')
      .update(updates)
      .eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[corrections PATCH]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '수정 실패' }, { status: 500 });
  }
}
