import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getAdminContext } from '@/lib/admin-context';

/**
 * POST /api/payments/operator-alias
 *
 * 분기 D에서 사장님이 신규 약칭을 기존 land_operator 에 등록할 때 호출.
 * 예: 거래자명 "(주)베스트투어" 가 land_operators.aliases 에 없으면
 *     사장님이 "(주)베스트투어 = 베스트아시아" 매핑을 추가.
 *
 * - 같은 alias 중복 등록 방지 (DISTINCT 적용)
 * - alias 길이 >= 2 만 허용 (false-positive 방지)
 * - audit log 적재
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 JSON' }, { status: 400 });
  }

  const { landOperatorId, newAliases } = body as {
    landOperatorId: string;
    newAliases: string[];
  };

  if (!landOperatorId || !Array.isArray(newAliases) || newAliases.length === 0) {
    return NextResponse.json(
      { error: 'landOperatorId, newAliases(>=1) 필수' },
      { status: 400 },
    );
  }

  // 정규화: trim + 길이 2~60자만 + case-insensitive 중복 제거
  const seenLower = new Set<string>();
  const sanitized: string[] = [];
  for (const a of newAliases) {
    const trimmed = (a ?? '').toString().trim();
    if (trimmed.length < 2 || trimmed.length > 60) continue;
    const key = trimmed.toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    sanitized.push(trimmed);
  }
  if (sanitized.length === 0) {
    return NextResponse.json({ error: 'alias 는 길이 2~60자 필요' }, { status: 400 });
  }

  try {
    const { data: opRow, error: opErr } = await supabaseAdmin
      .from('land_operators')
      .select('id, name, aliases')
      .eq('id', landOperatorId)
      .limit(1);
    if (opErr) throw opErr;
    type OpRow = { id: string; name: string; aliases: string[] | null };
    const op = (opRow as OpRow[] | null)?.[0];
    if (!op) {
      return NextResponse.json({ error: '랜드사를 찾을 수 없습니다' }, { status: 404 });
    }

    const existing: string[] = Array.isArray(op.aliases) ? op.aliases : [];
    const existingLower = new Set(existing.map(a => a.toLowerCase()));
    const merged = [...existing, ...sanitized.filter(a => !existingLower.has(a.toLowerCase()))];

    const { error: upErr } = await supabaseAdmin
      .from('land_operators')
      .update({ aliases: merged, updated_at: new Date().toISOString() })
      .eq('id', landOperatorId);
    if (upErr) throw upErr;

    await supabaseAdmin.from('payment_command_log').insert({
      raw_input: `[alias_add] op=${op.name} +${sanitized.join(',')}`,
      parsed_operator_alias: sanitized[0] ?? null,
      action: 'operator_alias_added',
      user_corrected: true,
      reasons: [`기존 ${existing.length}개 → ${merged.length}개`],
      created_by: getAdminContext(req).actor,
    });

    return NextResponse.json({
      ok: true,
      operator: { id: op.id, name: op.name, aliases: merged },
      added: sanitized.filter(a => !existing.includes(a)),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'alias 등록 실패' },
      { status: 500 },
    );
  }
}
