/**
 * 어필리에이터 카드뉴스 쿼터 관리
 *
 * - 월 생성 한도 체크
 * - 사용량 증가/초기화
 * - branding_level 기반 워터마크/브랜딩 제어
 */
import { supabaseAdmin } from '@/lib/supabase';

export type BrandingLevel = 'powered_by' | 'co_brand' | 'white_label';
export type TemplateTier = 'basic' | 'premium' | 'all';

export interface AffiliateContentAccess {
  allowed: boolean;
  reason?: string;
  quotaRemaining: number;
  brandingLevel: BrandingLevel;
  templateTier: TemplateTier;
  affiliateId: string;
  affiliateName: string;
}

/**
 * 어필리에이터의 콘텐츠 생성 권한과 남은 쿼터 확인
 */
export async function checkAffiliateContentQuota(
  affiliateId: string,
): Promise<AffiliateContentAccess> {
  const { data: affiliate, error } = await supabaseAdmin
    .from('affiliates')
    .select('id, name, content_quota, content_used, content_quota_reset_at, branding_level, template_tier, is_active')
    .eq('id', affiliateId)
    .single();

  if (error || !affiliate) {
    return {
      allowed: false,
      reason: '어필리에이터 정보를 찾을 수 없습니다',
      quotaRemaining: 0,
      brandingLevel: 'powered_by',
      templateTier: 'basic',
      affiliateId,
      affiliateName: '',
    };
  }

  if (!affiliate.is_active) {
    return {
      allowed: false,
      reason: '비활성화된 어필리에이터입니다',
      quotaRemaining: 0,
      brandingLevel: affiliate.branding_level as BrandingLevel || 'powered_by',
      templateTier: affiliate.template_tier as TemplateTier || 'basic',
      affiliateId,
      affiliateName: affiliate.name || '',
    };
  }

  // 월 쿼터 리셋 확인
  const today = new Date();
  const resetDate = affiliate.content_quota_reset_at
    ? new Date(affiliate.content_quota_reset_at)
    : new Date(0);

  if (today.getMonth() !== resetDate.getMonth() || today.getFullYear() !== resetDate.getFullYear()) {
    // 새 달 → 사용량 리셋
    const { error: resetError } = await supabaseAdmin
      .from('affiliates')
      .update({
        content_used: 0,
        content_quota_reset_at: today.toISOString().slice(0, 10),
      })
      .eq('id', affiliateId);

    if (!resetError) {
      return {
        allowed: true,
        quotaRemaining: affiliate.content_quota,
        brandingLevel: affiliate.branding_level as BrandingLevel || 'powered_by',
        templateTier: affiliate.template_tier as TemplateTier || 'basic',
        affiliateId,
        affiliateName: affiliate.name || '',
      };
    }
  }

  const used = affiliate.content_used || 0;
  const quota = affiliate.content_quota || 10;
  const remaining = Math.max(0, quota - used);

  if (remaining <= 0) {
    return {
      allowed: false,
      reason: `월 생성 한도 소진 (${quota}개/${quota}개). 업그레이드하려면 관리자에게 문의하세요`,
      quotaRemaining: 0,
      brandingLevel: affiliate.branding_level as BrandingLevel || 'powered_by',
      templateTier: affiliate.template_tier as TemplateTier || 'basic',
      affiliateId,
      affiliateName: affiliate.name || '',
    };
  }

  return {
    allowed: true,
    quotaRemaining: remaining,
    brandingLevel: affiliate.branding_level as BrandingLevel || 'powered_by',
    templateTier: affiliate.template_tier as TemplateTier || 'basic',
    affiliateId,
    affiliateName: affiliate.name || '',
  };
}

/**
 * 어필리에이터 콘텐츠 생성 사용량 증가
 */
export async function incrementAffiliateContentUsage(
  affiliateId: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin.rpc('increment_affiliate_content_usage', {
    p_affiliate_id: affiliateId,
  });

  if (error) {
    // RPC 없으면 직접 업데이트
    const { error: updateError } = await supabaseAdmin
      .from('affiliates')
      .update({
        content_used: supabaseAdmin.rpc('increment', { x: 1 }) as unknown as number,
      })
      .eq('id', affiliateId);

    if (updateError) {
      console.error('[affiliate-quota] 사용량 증가 실패:', updateError.message);
      return false;
    }
  }
  return true;
}

/**
 * 월별 사용량 기록
 */
export async function logAffiliateMonthlyUsage(
  affiliateId: string,
  monthStr: string,  // '2026-05-01'
  increment: {
    content_generated?: number;
    blog_posts_generated?: number;
    ig_posts_published?: number;
  },
): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('affiliate_monthly_usage')
    .select('*')
    .eq('affiliate_id', affiliateId)
    .eq('month', monthStr)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('affiliate_monthly_usage')
      .update({
        content_generated: (existing.content_generated || 0) + (increment.content_generated || 0),
        blog_posts_generated: (existing.blog_posts_generated || 0) + (increment.blog_posts_generated || 0),
        ig_posts_published: (existing.ig_posts_published || 0) + (increment.ig_posts_published || 0),
        updated_at: new Date().toISOString(),
      })
      .eq('affiliate_id', affiliateId)
      .eq('month', monthStr);
  } else {
    await supabaseAdmin
      .from('affiliate_monthly_usage')
      .insert({
        affiliate_id: affiliateId,
        month: monthStr,
        content_generated: increment.content_generated || 0,
        blog_posts_generated: increment.blog_posts_generated || 0,
        ig_posts_published: increment.ig_posts_published || 0,
      });
  }
}
