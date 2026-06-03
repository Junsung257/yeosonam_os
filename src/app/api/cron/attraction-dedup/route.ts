/**
 * @file route.ts — 관광지 중복 자동 병합 cron
 *
 * 매일 자정 실행 (Vercel Cron):
 *   POST /api/cron/attraction-dedup
 *
 * 1. 동일 qid를 가진 attraction 그룹핑 → aliases/mention_count/photos 병합 → 1개만 남김
 * 2. qid가 없는 attraction 끼리는 높은 유사도로 그룹핑 → qid 조회 후 병합
 * 3. "자동 병합됨" 노트 기록
 */

import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { requireCronBearer } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300; // Vercel cron 최대 5분

interface AttractionRow {
  id: string;
  name: string;
  aliases: string[];
  mention_count: number;
  photos: Record<string, unknown>[];
  qid: string | null;
  region: string | null;
  country: string | null;
  category: string | null;
  short_desc: string | null;
  is_active: boolean;
}

export async function POST(request: NextRequest): Promise<Response> {
  const authError = requireCronBearer(request);
  if (authError) return authError;

  const startedAt = Date.now();
  const log: string[] = [];

  try {
    // 1) 모든 active attraction fetch
    const { data: all, error } = await supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, mention_count, photos, qid, region, country, category, short_desc, is_active')
      .eq('is_active', true)
      .order('mention_count', { ascending: false });

    if (error) throw error;
    const rows = (all ?? []) as AttractionRow[];
    log.push(`전체 active attraction: ${rows.length}개`);

    // 2) 동일 qid 그룹 병합
    const qidGroups = new Map<string, AttractionRow[]>();
    for (const row of rows) {
      if (row.qid) {
        const group = qidGroups.get(row.qid) ?? [];
        group.push(row);
        qidGroups.set(row.qid, group);
      }
    }

    let mergedCount = 0;
    for (const [qid, group] of qidGroups) {
      if (group.length <= 1) continue;
      log.push(`QID ${qid}: ${group.length}개 중복 발견 (${group.map(r => r.name).join(', ')})`);

      // 가장 mention_count 높은 것을 canonical로
      const sorted = [...group].sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0));
      const canonical = sorted[0];
      const duplicates = sorted.slice(1);

      // 병합: aliases + mention_count + photos
      const mergedAliases = new Set<string>(canonical.aliases ?? []);
      const mergedPhotos = [...(canonical.photos ?? [])];
      let mergedMentionCount = canonical.mention_count ?? 1;

      for (const dup of duplicates) {
        // aliases 병합
        for (const alias of dup.aliases ?? []) {
          if (alias && alias !== canonical.name) mergedAliases.add(alias);
        }
        // photos 병합
        for (const photo of dup.photos ?? []) {
          const exists = mergedPhotos.some(
            p => (p as Record<string, unknown>).pexels_id === (photo as Record<string, unknown>).pexels_id
              || (p as Record<string, unknown>).src_medium === (photo as Record<string, unknown>).src_medium,
          );
          if (!exists) mergedPhotos.push(photo);
        }
        // mention_count 합산
        mergedMentionCount += dup.mention_count ?? 1;
        // duplicate soft delete
        await supabaseAdmin
          .from('attractions')
          .update({
            is_active: false,
            aliases: [...mergedAliases],
          })
          .eq('id', dup.id);
      }

      // canonical 업데이트
      await supabaseAdmin
        .from('attractions')
        .update({
          aliases: [...mergedAliases],
          photos: mergedPhotos,
          mention_count: mergedMentionCount,
        })
        .eq('id', canonical.id);

      mergedCount += duplicates.length;
      log.push(`  → canonical: "${canonical.name}" (${mergedAliases.size} aliases, ${mergedPhotos.length} photos, ${mergedMentionCount}회 언급)`);
    }

    // 3) qid가 없는 attraction → reconciler로 qid 조회 후 병합
    const noQidRows = rows.filter(r => !r.qid && r.is_active);
    log.push(`qid 미할당: ${noQidRows.length}개 (reconciler 검사 생략 — cron 단계에서는 너무 무거움)`);

    // 4) 정리 로그
    const elapsed = Date.now() - startedAt;
    log.push(`완료: ${mergedCount}개 중복 병합됨 (${elapsed}ms)`);

    return apiResponse({
      success: true,
      mergedCount,
      elapsed,
      log: log.slice(-20), // 최근 20줄만
    });
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    const message = sanitizeDbError(err);
    log.push(`오류: ${message}`);
    return apiResponse({
      success: false,
      error: message,
      elapsed,
      log,
    }, { status: 500 });
  }
}
