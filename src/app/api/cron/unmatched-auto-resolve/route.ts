import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { suggestAttractionsForActivity, type AttractionSuggestRow } from '@/lib/unmatched-suggest';
import { reEnrichAffectedPackages } from '@/lib/package-reenrich-on-attraction-change';

export const dynamic = 'force-dynamic';

/**
 * 고신뢰 미매칭 자동해결 크론
 * - score >= UNMATCHED_AUTO_RESOLVE_MIN_SCORE (기본 95)
 * - attractions.aliases 자동 적립 + unmatched_activities resolved 처리
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, scanned: 0, resolved: 0 });

  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  try {
    const minScore = parseFloat(process.env.UNMATCHED_AUTO_RESOLVE_MIN_SCORE || '95');
    const limit = Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || '200', 10));

    const [{ data: unresolved }, { data: attractions }] = await Promise.all([
      supabaseAdmin
        .from('unmatched_activities')
        .select('id, activity, region, country')
        .eq('status', 'pending')
        .is('resolved_at', null)
        .order('occurrence_count', { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from('attractions')
        .select('id, name, aliases, region, country, category, emoji, short_desc')
        .eq('is_active', true)
        .limit(5000),
    ]);

    const candidateRows = (attractions || []) as AttractionSuggestRow[];
    let resolved = 0;
    let scanned = 0;
    const errors: string[] = [];
    const affectedAttractionIds = new Set<string>();

    for (const row of unresolved || []) {
      scanned++;
      const u = row as { id: string; activity: string; region: string | null; country: string | null };
      const scoped = candidateRows.filter(a =>
        (!u.region || !a.region || a.region === u.region) &&
        (!u.country || !a.country || a.country === u.country),
      );
      const pool = scoped.length > 0 ? scoped : candidateRows;
      const { suggestions } = suggestAttractionsForActivity(u.activity, pool, minScore, 1);
      if (suggestions.length === 0) continue;

      const top = suggestions[0];
      const { data: target } = await supabaseAdmin
        .from('attractions')
        .select('id, aliases')
        .eq('id', top.id)
        .single();
      if (!target) continue;

      const aliases = ((target.aliases as string[] | null) || []);
      const newAlias = u.activity;
      if (!aliases.includes(newAlias)) {
        const { error: aliasErr } = await supabaseAdmin
          .from('attractions')
          .update({ aliases: [...aliases, newAlias] })
          .eq('id', top.id);
        if (aliasErr) {
          errors.push(aliasErr.message);
          continue;
        }
      }

      const { error: updErr } = await supabaseAdmin
        .from('unmatched_activities')
        .update({
          // link_alias 수동 처리와 동일: alias 적립 완료 → '추가됨' 탭에서 추적 가능
          status: 'added',
          resolved_at: new Date().toISOString(),
          resolved_kind: 'auto_cron_high_confidence',
          resolved_attraction_id: top.id,
          resolved_by: 'cron_unmatched_auto_resolve',
        })
        .eq('id', u.id);
      if (updErr) {
        errors.push(updErr.message);
        continue;
      }
      resolved++;
      affectedAttractionIds.add(top.id);
    }

    // PR #93 갭 E — cron 일일 sweep 후 영향받은 패키지 itinerary_data 일괄 재계산 + ISR 무효화
    let reenrich: { scanned_packages: number; updated_packages: number; revalidated_paths: number } | null = null;
    if (affectedAttractionIds.size > 0) {
      try {
        const r = await reEnrichAffectedPackages([...affectedAttractionIds], { maxPackages: 200 });
        reenrich = { scanned_packages: r.scanned_packages, updated_packages: r.updated_packages, revalidated_paths: r.revalidated_paths };
      } catch (e) {
        console.warn('[cron unmatched-auto-resolve] re-enrich 실패:', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({
      ok: true,
      scanned,
      resolved,
      minScore,
      reenrich,
      errors: errors.slice(0, 20),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
