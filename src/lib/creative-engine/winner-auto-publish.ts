/**
 * Winner 자동 발행 — A/B 테스트 결과 Winner → Instagram 캐러셀 자동 게시
 *
 * 흐름:
 *   1. 테넌트의 미결정 variant_group 조회
 *   2. detectVariantWinner() 로 engagement 기반 winner 결정
 *   3. decided=true 이고 ig_slide_urls 있으면 Meta Graph API 발행
 *   4. card_news.ig_post_id / ig_published_at / ig_publish_status / status 업데이트
 *
 * Inngest daily-marketing → tenant-marketing step 에서 호출.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { detectVariantWinner } from '@/lib/card-news-html/winner-detector';
import { publishCarouselToInstagram, getInstagramConfig } from '@/lib/instagram-publisher';

export interface AutoPublishReport {
  tenant_id: string;
  groups_checked: number;
  winners_decided: number;
  published: number;
  skipped: number;
  errors: { group_id: string; error: string }[];
}

/**
 * 테넌트의 미결정 variant_group 을 순회하며 winner 결정 + IG 발행.
 * Inngest step 내부에서 호출된다 (재시도 안전).
 */
export async function autoPublishWinners(tenantId: string): Promise<AutoPublishReport> {
  const report: AutoPublishReport = {
    tenant_id: tenantId,
    groups_checked: 0,
    winners_decided: 0,
    published: 0,
    skipped: 0,
    errors: [],
  };

  if (!isSupabaseConfigured) return report;

  // 1. 아직 winner 미결정인 variant group UUID 목록 (ig_slide_urls 있는 카드 포함)
  const { data: groups, error: groupErr } = await supabaseAdmin
    .from('card_news')
    .select('variant_group_id')
    .eq('tenant_id', tenantId)
    .not('variant_group_id', 'is', null)
    .eq('is_winner', false)
    .is('winner_decided_at', null)
    .not('ig_slide_urls', 'is', null)
    .neq('status', 'ARCHIVED');

  if (groupErr) {
    report.errors.push({ group_id: 'query', error: groupErr.message });
    return report;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawGroups = (groups ?? []) as any[];
  const uniqueGroups: string[] = [
    ...new Set<string>(rawGroups.map((r) => (r.variant_group_id as string | null) ?? '')),
  ].filter((id) => id.length > 0);
  report.groups_checked = uniqueGroups.length;

  if (uniqueGroups.length === 0) return report;

  // 2. 그룹별 winner 결정 시도
  const igConfig = await getInstagramConfig(tenantId);

  for (const groupId of uniqueGroups) {
    try {
      const decision = await detectVariantWinner({
        variantGroupId: String(groupId),
        archiveLosers: false, // 발행 전 ARCHIVE는 하지 않음
        dryRun: false,
      });

      if (!decision.decided || !decision.winner) {
        report.skipped++;
        continue;
      }

      report.winners_decided++;
      const winner = decision.winner;

      // 이미 발행됐거나 ig_slide_urls 없으면 건너뜀
      if (winner.ig_post_id) {
        report.skipped++;
        continue;
      }

      // 3. IG 슬라이드 URL 조회
      const { data: cardRow } = await supabaseAdmin
        .from('card_news')
        .select('ig_slide_urls, ig_caption')
        .eq('id', winner.id)
        .maybeSingle();

      const slideUrls: string[] | null = cardRow?.ig_slide_urls ?? null;
      const caption: string = cardRow?.ig_caption ?? `${winner.variant_angle ?? '여행'} 패키지 — 여소남 엄선`;

      if (!slideUrls || slideUrls.length < 2) {
        report.skipped++;
        continue;
      }

      if (!igConfig) {
        report.skipped++;
        console.warn(`[winner-auto-publish] tenant ${tenantId}: IG 설정 없음, group ${groupId} 건너뜀`);
        continue;
      }

      // 4. Meta Graph API 발행
      await supabaseAdmin
        .from('card_news')
        .update({ ig_publish_status: 'publishing' })
        .eq('id', winner.id);

      const result = await publishCarouselToInstagram({
        igUserId: igConfig.igUserId,
        accessToken: igConfig.accessToken,
        imageUrls: slideUrls,
        caption,
      });

      if (result.ok && result.postId) {
        await supabaseAdmin
          .from('card_news')
          .update({
            ig_post_id: result.postId,
            ig_published_at: new Date().toISOString(),
            ig_publish_status: 'published',
            status: 'LAUNCHED',
          })
          .eq('id', winner.id);

        report.published++;
      } else {
        await supabaseAdmin
          .from('card_news')
          .update({
            ig_publish_status: 'failed',
            ig_error: result.error ?? '알 수 없는 오류',
          })
          .eq('id', winner.id);

        report.errors.push({ group_id: String(groupId), error: result.error ?? 'IG 발행 실패' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.errors.push({ group_id: String(groupId), error: msg });
      console.error(`[winner-auto-publish] group ${groupId} 처리 실패:`, msg);
    }
  }

  return report;
}
