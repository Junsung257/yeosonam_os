/**
 * 다크 소셜·SNS 공유 시 UTM을 붙여 귀속/분석 가능하게 함.
 */

export type ShareChannel = 'kakao' | 'facebook' | 'twitter' | 'copy';

const UTM_SOURCE: Record<ShareChannel, string> = {
  kakao: 'share_kakao',
  facebook: 'share_facebook',
  twitter: 'share_twitter',
  copy: 'share_copy',
};

export function buildTrackedShareUrl(
  absoluteUrl: string,
  opts: { channel: ShareChannel; utmCampaign?: string },
): string {
  try {
    const u = new URL(absoluteUrl, typeof window !== 'undefined' ? window.location.origin : 'https://www.yeosonam.com');
    u.searchParams.set('utm_source', UTM_SOURCE[opts.channel]);
    u.searchParams.set('utm_medium', 'social');
    if (opts.utmCampaign?.trim()) {
      u.searchParams.set('utm_campaign', opts.utmCampaign.trim());
    }
    u.searchParams.set('utm_content', opts.channel);
    return u.toString();
  } catch {
    return absoluteUrl;
  }
}
