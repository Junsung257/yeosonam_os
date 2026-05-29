import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { suggestAttractionsForActivity, type AttractionSuggestRow } from '@/lib/unmatched-suggest';
// P11-3: suggestFromWikidata → reconcilePlaceName 로 대체됨
import { cleanActivity } from '@/lib/unmatched-suggest';
import { reEnrichAffectedPackages } from '@/lib/package-reenrich-on-attraction-change';

export const dynamic = 'force-dynamic';

/**
 * 고신뢰 미매칭 자동해결 크론
 * - 1차: 내부 attractions 매칭 (score >= UNMATCHED_AUTO_RESOLVE_MIN_SCORE, 기본 75)
 * - 2차: 내부 매칭 실패 → Wikidata reconcile
 *   - confidence >= 0.85 + tourist attraction type → attractions auto INSERT (P11-3)
 *   - confidence < 0.85 → note 에 Wikidata 정보만 저장 (어드민 수동 확인)
 * - 3차: photo + description fire-and-forget (auto-insert 후 백그라운드)
 *
 * P11-3 변경 (2026-05-24):
 *   - STRICT SSOT 정책 완화: high-confidence Wikidata POI 는 자동 INSERT
 *   - Wikibase Reconcile API (wbsearchentities + type/country filter)
 *   - 동일 qid 중복 방지 (qid UNIQUE 인덱스)
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, scanned: 0, resolved: 0 });

  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

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
            errors.push(aliasErr.message);
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
          errors.push(updErr.message);
          continue;
        }
        resolved++;
        affectedAttractionIds.add(top.id);
        continue;
      }

      // 2차: 내부 매칭 실패 → Wikidata reconcile
      //   P11-3: confidence >= 0.85 + tourist attraction type → auto INSERT
      //          confidence < 0.85 → note 에만 저장 (기존 동작 유지)
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
                // ── high-confidence: auto INSERT ──
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
                  // 신규 auto INSERT
                  const aliasSet = new Set<string>([u.activity, top.label_ko || '', top.label_en || ''].filter(Boolean));
                  for (const a of top.aliases) {
                    if (a !== top.label_ko && a !== top.label_en) aliasSet.add(a);
                  }
                  const { inferCategory } = await import('@/lib/parser/attraction-category');
                  const category = inferCategory(u.activity, top.type_qid || undefined);
                  const photos = top.image_url
                    ? [{ src_medium: top.image_url, src_large: top.image_url, photographer: 'Wikimedia Commons', source: 'wikimedia' }]
                    : [];

                  const { data: created } = await supabaseAdmin.from('attractions').insert({
                    name: top.label_ko || top.label_en || u.activity,
                    qid: top.qid,
                    aliases: [...aliasSet].filter(Boolean),
                    short_desc: top.description?.slice(0, 30) || null,
                    country: u.country,
                    region: u.region,
                    category,
                    photos,
                    mention_count: 1,
                    is_active: true,
                  }).select('id, name').single();

                  if (created) {
                    await supabaseAdmin.from('unmatched_activities').update({
                      status: 'added',
                      note: `auto-inserted: ${top.qid} (conf=${top.confidence.toFixed(2)})`,
                      resolved_at: now,
                      resolved_kind: 'auto_cron_wikidata_insert',
                      resolved_attraction_id: created.id,
                      resolved_by: 'cron_unmatched_auto_resolve',
                    }).eq('id', u.id);
                    affectedAttractionIds.add(created.id);
                    resolved++;

                    // fire-and-forget: photo + description
                    void (async () => {
                      try {
                        const { generateAttractionDescription } = await import('@/lib/attraction-desc-gen');
                        const desc = await generateAttractionDescription(top.label_ko || top.label_en || u.activity, {
                          qid: top.qid, wdDescription: top.description, destination: u.region,
                        });
                        await supabaseAdmin.from('attractions').update({ short_desc: desc.short_desc, updated_at: now }).eq('id', created.id);

                        const { runAttractionPhotoMatch } = await import('@/lib/attraction-photo-match');
                        await runAttractionPhotoMatch(created.id, {
                          keywords: [top.label_ko || '', top.label_en || '', u.activity, ...top.aliases].filter(Boolean),
                          qid: top.qid, maxPhotos: 5,
                        });
                      } catch {}
                    })();
                  }
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
        console.warn('[cron unmatched-auto-resolve] re-enrich 실패:', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({
      ok: true,
      scanned,
      resolved,
      minScore,
      wikidataSuggested,
      reenrich,
      errors: errors.slice(0, 20),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
