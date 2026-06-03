import { type NextRequest } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { suggestAttractionsForActivity, type AttractionSuggestRow } from '@/lib/unmatched-suggest';
// P11-3: suggestFromWikidata → reconcilePlaceName 로 대체됨
import { cleanActivity } from '@/lib/unmatched-suggest';
import { reEnrichAffectedPackages } from '@/lib/package-reenrich-on-attraction-change';
import { canCreateAttractionRecord } from '@/lib/attraction-policy';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

/**
 * 고신뢰 미매칭 자동해결 크론
 * - 1차: 내부 attractions 매칭 (score >= UNMATCHED_AUTO_RESOLVE_MIN_SCORE, 기본 75)
 * - 2차: 내부 매칭 실패 → Wikidata reconcile
 *   - 기존 qid가 있으면 alias 자동 연결
 *   - 신규 qid는 자동 INSERT 하지 않고 note 제안만 저장 (어드민 수동 확인)
 *
 * SSOT: docs/product-registration-v3-standard-language.md
 *   - 자동 신규 attraction INSERT 금지
 *   - match/alias/unmatched review 흐름만 자동화
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) return apiResponse({ ok: true, scanned: 0, resolved: 0 });

  try {
    const minScore = parseFloat(process.env.UNMATCHED_AUTO_RESOLVE_MIN_SCORE || '75');
    const limit = Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || (process.env.UNMATCHED_AUTO_RESOLVE_LIMIT || '500'), 10));
    const wikidataEnabled = process.env.UNMATCHED_AUTO_RESOLVE_WIKIDATA !== 'false';

    const [{ data: unresolved }, { data: attractions }] = await Promise.all([
      supabaseAdmin
        .from('unmatched_activities')
        .select('id, activity, region, country, note')
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
    let wikidataSuggested = 0;
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
      if (suggestions.length > 0) {
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
            errors.push(sanitizeDbError(aliasErr, 'Failed to update attraction alias'));
            continue;
          }
        }

        const { error: updErr } = await supabaseAdmin
          .from('unmatched_activities')
          .update({
            status: 'added',
            resolved_at: new Date().toISOString(),
            resolved_kind: 'auto_cron_high_confidence',
            resolved_attraction_id: top.id,
            resolved_by: 'cron_unmatched_auto_resolve',
          })
          .eq('id', u.id);
        if (updErr) {
          errors.push(sanitizeDbError(updErr, 'Failed to resolve unmatched activity'));
          continue;
        }
        resolved++;
        affectedAttractionIds.add(top.id);
        continue;
      }

      // 2차: 내부 매칭 실패 → Wikidata reconcile
      //   confidence >= 0.85 이면 기존 qid alias 연결 시도
      //   신규 qid는 note 제안만 저장 (자동 INSERT 금지)
      if (wikidataEnabled) {
        try {
          const cleaned = cleanActivity(u.activity);
          if (cleaned && cleaned.length >= 2) {
            const { reconcilePlaceName } = await import('@/lib/wikidata-reconcile');
            const reconciled = await reconcilePlaceName(cleaned, {
              country: u.country || undefined,
              typeId: 'Q570',
              topRes: 3,
            });

            if (reconciled.length > 0) {
              const top = reconciled[0];
              const now = new Date().toISOString();

              if (top.confidence >= 0.85) {
                // SSOT: docs/product-registration-v3-standard-language.md
                // 자동 신규 INSERT 금지. 기존 attraction 매칭/alias 연결까지만 자동 처리.
                const { data: existing } = await supabaseAdmin
                  .from('attractions')
                  .select('id, aliases')
                  .eq('qid', top.qid)
                  .maybeSingle();

                if (existing) {
                  // 기존 attraction 에 alias 연결
                  const existingAliases: string[] = (existing.aliases as string[] | null) ?? [];
                  if (!existingAliases.includes(u.activity)) {
                    await supabaseAdmin.from('attractions').update({
                      aliases: [...new Set([...existingAliases, u.activity])],
                      updated_at: now,
                    }).eq('id', existing.id);
                  }
                  await supabaseAdmin.from('unmatched_activities').update({
                    status: 'added',
                    note: `auto-matched: ${top.qid} (conf=${top.confidence.toFixed(2)})`,
                    resolved_at: now,
                    resolved_kind: 'auto_cron_wikidata_match',
                    resolved_attraction_id: existing.id,
                    resolved_by: 'cron_unmatched_auto_resolve',
                  }).eq('id', u.id);
                  affectedAttractionIds.add(existing.id);
                } else {
                  if (canCreateAttractionRecord('cron')) {
                    errors.push('policy violation: cron attraction auto-create must be disabled');
                    continue;
                  }
                  // 신규 후보는 unmatched 큐 유지 + 제안 정보만 note에 저장
                  const wdInfo = JSON.stringify({
                    wikidata_suggested_at: now,
                    qid: top.qid,
                    label: top.label_ko,
                    description: top.description,
                    image_url: top.image_url,
                    confidence: top.confidence,
                  });
                  const existingNote = (row as { note?: string | null }).note || '';
                  const newNote = existingNote
                    ? `${existingNote}\n[WIKIDATA_SUGGEST] ${wdInfo}`
                    : `[WIKIDATA_SUGGEST] ${wdInfo}`;
                  await supabaseAdmin.from('unmatched_activities').update({
                    note: newNote,
                    status: 'pending',
                  }).eq('id', u.id);
                }
              } else {
                // ── low confidence: note 에만 저장 ──
                const wdInfo = JSON.stringify({
                  wikidata_suggested_at: now,
                  qid: top.qid,
                  label: top.label_ko,
                  description: top.description,
                  image_url: top.image_url,
                  confidence: top.confidence,
                });
                const existingNote = (row as { note?: string | null }).note || '';
                const newNote = existingNote
                  ? `${existingNote}\n[WIKIDATA] ${wdInfo}`
                  : `[WIKIDATA] ${wdInfo}`;
                await supabaseAdmin.from('unmatched_activities').update({
                  note: newNote,
                }).eq('id', u.id);
                wikidataSuggested++;
              }
            }
          }
        } catch {
          // Wikidata 실패는 무시
        }
      }
    }

    // PR #93 갭 E — cron 일일 sweep 후 영향받은 패키지 itinerary_data 일괄 재계산 + ISR 무효화
    let reenrich: { scanned_packages: number; updated_packages: number; revalidated_paths: number } | null = null;
    if (affectedAttractionIds.size > 0) {
      try {
        const r = await reEnrichAffectedPackages([...affectedAttractionIds], { maxPackages: 200 });
        reenrich = { scanned_packages: r.scanned_packages, updated_packages: r.updated_packages, revalidated_paths: r.revalidated_paths };
      } catch (e) {
        console.warn(
          '[cron unmatched-auto-resolve] re-enrich failed:',
          sanitizeDbError(e, 're-enrich failed'),
        );
      }
    }

    return apiResponse({
      ok: true,
      scanned,
      resolved,
      minScore,
      wikidataSuggested,
      reenrich,
      errors: errors.slice(0, 20),
    });
  } catch (e) {
    return apiResponse(
      { ok: false, error: sanitizeDbError(e, 'failed') },
      { status: 500 },
    );
  }
}
