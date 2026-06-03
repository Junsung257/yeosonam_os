/**
 * B 박제 (2026-05-15): 어드민 attraction alias 수동 추가/삭제 API.
 *
 * 사장님 비전: 자동 OTA fetch 의 SPA 한계를 사장님 도메인 전문성으로 보완.
 *   - 어드민 검수 큐에서 1-click 으로 표기 변형 추가
 *   - 사장님 비용 0 + 정확도 +5%
 */

import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { revalidatePath } from 'next/cache';
import { reEnrichAffectedPackages } from '@/lib/package-reenrich-on-attraction-change';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

const MAX_ALIAS_LENGTH = 60;
const MAX_ALIASES = 30;

/** POST: alias 추가. body: { alias: string } */
export const POST = withAdminGuard(async (req: NextRequest, ctx?: { params?: Promise<{ id: string }> }) => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'no_db' }, { status: 503 });
  const params = await ctx?.params;
  const id = params?.id;
  if (!id) return apiResponse({ error: 'missing_id' }, { status: 400 });

  let body: { alias?: string };
  try { body = await req.json(); }
  catch { return apiResponse({ error: 'invalid_json' }, { status: 400 }); }

  const alias = (body.alias ?? '').trim();
  if (!alias || alias.length < 2 || alias.length > MAX_ALIAS_LENGTH) {
    return apiResponse({ error: `alias 길이는 2~${MAX_ALIAS_LENGTH}자` }, { status: 400 });
  }
  if (!/[가-힣A-Za-z]/.test(alias)) {
    return apiResponse({ error: '한글 또는 영문 포함 필수' }, { status: 400 });
  }

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('attractions')
    .select('id, name, aliases')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr || !existing) {
    return apiResponse({ error: 'not_found' }, { status: 404 });
  }
  const prev = Array.isArray((existing as { aliases?: string[] }).aliases)
    ? ((existing as { aliases: string[] }).aliases)
    : [];
  // 중복 (lowercase + 공백 제거 비교)
  const key = alias.toLowerCase().replace(/\s+/g, '');
  if (prev.some(a => a.toLowerCase().replace(/\s+/g, '') === key)) {
    return apiResponse({ ok: true, aliases: prev, message: '이미 존재' });
  }
  if (prev.length >= MAX_ALIASES) {
    return apiResponse({ error: `최대 ${MAX_ALIASES}개 제한` }, { status: 400 });
  }
  const next = [...prev, alias];

  const { error: upErr } = await supabaseAdmin
    .from('attractions')
    .update({ aliases: next })
    .eq('id', id);
  if (upErr) return apiResponse({ error: sanitizeDbError(upErr) }, { status: 500 });

  // ISR 무효화 — 해당 attraction 이 포함된 페이지들이 다음 fetch 에서 즉시 갱신
  revalidatePath('/packages', 'layout');

  // PR #93 갭 B/C — alias 추가 후 영향받은 패키지 itinerary_data 재계산 + 개별 ISR 무효화.
  //   layout 무효화만으로는 개별 page ISR 캐시 미적중 위험. 명시 reenrich 로 itinerary_data 의
  //   attraction_ids 까지 업데이트하여 모바일 즉시 반영.
  void reEnrichAffectedPackages([id], { maxPackages: 50 })
    .catch(e => console.warn('[Aliases API] re-enrich failed:', sanitizeDbError(e)));

  return apiResponse({ ok: true, aliases: next });
});

/** DELETE: alias 삭제. body: { alias: string } */
export const DELETE = withAdminGuard(async (req: NextRequest, ctx?: { params?: Promise<{ id: string }> }) => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'no_db' }, { status: 503 });
  const params = await ctx?.params;
  const id = params?.id;
  if (!id) return apiResponse({ error: 'missing_id' }, { status: 400 });

  let body: { alias?: string };
  try { body = await req.json(); }
  catch { return apiResponse({ error: 'invalid_json' }, { status: 400 }); }

  const alias = (body.alias ?? '').trim();
  if (!alias) return apiResponse({ error: 'missing_alias' }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from('attractions')
    .select('aliases')
    .eq('id', id)
    .maybeSingle();
  const prev = Array.isArray((existing as { aliases?: string[] } | null)?.aliases)
    ? ((existing as { aliases: string[] }).aliases)
    : [];
  const key = alias.toLowerCase().replace(/\s+/g, '');
  const next = prev.filter(a => a.toLowerCase().replace(/\s+/g, '') !== key);
  if (next.length === prev.length) {
    return apiResponse({ ok: true, aliases: prev, message: '존재하지 않음' });
  }
  const { error: upErr } = await supabaseAdmin
    .from('attractions')
    .update({ aliases: next })
    .eq('id', id);
  if (upErr) return apiResponse({ error: sanitizeDbError(upErr) }, { status: 500 });

  revalidatePath('/packages', 'layout');
  return apiResponse({ ok: true, aliases: next });
});
