'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';

interface BrandKit {
  primary_color: string | null;
  accent_color: string | null;
  background_color: string | null;
  font_family: string | null;
  logo_url: string | null;
  logo_light_url: string | null;
  brand_name: string | null;
  brand_tagline: string | null;
}

interface AffiliatePublic {
  name: string;
  referral_code: string;
  logo_url: string | null;
  profile_image_url: string | null;
  bio: string | null;
  social_links: Record<string, string> | null;
  branding_level: string | null;
  landing_intro: string | null;
  landing_video_url: string | null;
}

interface CardNewsPublic {
  id: string;
  title: string;
  template_family: string | null;
  variant_angle: string | null;
  thumbnail_url: string | null;
  created_at: string;
  engagement_score: number | null;
}

interface ProfileData {
  affiliate: AffiliatePublic;
  brand_kit: BrandKit | null;
  card_news: CardNewsPublic[];
  packages: unknown[];
}

const SOCIAL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  threads: 'Threads',
  twitter: 'X / Twitter',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  blog: '블로그',
  website: '웹사이트',
};

const SOCIAL_ICONS: Record<string, string> = {
  instagram: '📸',
  threads: '🧵',
  twitter: '🐦',
  youtube: '🎬',
  tiktok: '🎵',
  blog: '📝',
  website: '🌐',
};

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

export default function AffiliateLinkInBioPage() {
  const params = useParams<{ referral_code?: string | string[] }>();
  const referralCode = getRouteParam(params?.referral_code);
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!referralCode) {
        setError('추천인 코드가 올바르지 않습니다.');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/affiliate/public/${encodeURIComponent(referralCode)}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error('어필리에이터를 찾을 수 없습니다');
          throw new Error('로드 실패');
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : '로드 실패');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [referralCode]);

  // 브랜드 컬러
  const primaryColor = data?.brand_kit?.primary_color ?? '#4F46E5';
  const bgColor = data?.brand_kit?.background_color ?? '#FFFFFF';
  const fontFamily = data?.brand_kit?.font_family ?? 'inherit';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: bgColor }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-3 text-sm text-gray-500">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8">
          <div className="text-4xl mb-3">🔗</div>
          <h1 className="text-lg font-bold text-gray-700 mb-2">링크를 찾을 수 없습니다</h1>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { affiliate: a, brand_kit: bk, card_news } = data;
  const displayLogo = bk?.logo_url || a.logo_url;
  const displayName = bk?.brand_name || a.name;

  return (
    <div className="min-h-screen" style={{ background: bgColor, fontFamily }}>
      {/* 헤더 */}
      <div
        className="text-white py-16 px-6 text-center relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${primaryColor} 0%, ${adjustColor(primaryColor, -30)} 100%)`,
        }}
      >
        {/* 프로필 이미지 */}
        <div className="relative mx-auto mb-4 w-24 h-24">
          {a.profile_image_url || displayLogo ? (
            <Image
              src={a.profile_image_url || displayLogo!}
              alt={displayName}
              fill
              className="rounded-full object-cover border-4 border-white/50"
              sizes="96px"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center text-3xl font-bold">
              {displayName.charAt(0)}
            </div>
          )}
        </div>

        {/* 이름 */}
        <h1 className="text-2xl font-bold mb-1">{displayName}</h1>
        {bk?.brand_tagline && (
          <p className="text-sm text-white/80 mb-1">{bk.brand_tagline}</p>
        )}
        {a.bio && (
          <p className="text-sm text-white/70 max-w-md mx-auto leading-relaxed">{a.bio}</p>
        )}

        {/* 브랜드 레벨 배지 */}
        {a.branding_level && a.branding_level !== 'powered_by' && (
          <div className="mt-3">
            <span className="inline-block px-3 py-1 rounded-full text-[11px] font-medium bg-white/20 text-white/90">
              {a.branding_level === 'white_label' ? '화이트라벨' : '코브랜딩'}
            </span>
          </div>
        )}
      </div>

      {/* 소셜 링크 */}
      {a.social_links && Object.keys(a.social_links).length > 0 && (
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="flex flex-wrap justify-center gap-2">
            {Object.entries(a.social_links).map(([platform, url]) => (
              <a
                key={platform}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors hover:opacity-80"
                style={{
                  backgroundColor: `${primaryColor}15`,
                  color: primaryColor,
                  border: `1px solid ${primaryColor}30`,
                }}
              >
                <span>{SOCIAL_ICONS[platform] ?? '🔗'}</span>
                <span>{SOCIAL_LABELS[platform] ?? platform}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 추천 패키지 */}
      {data.packages.length > 0 && (
        <div className="max-w-md mx-auto px-4 py-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 px-1">🏖️ 추천 여행</h2>
          <div className="grid grid-cols-2 gap-3">
            {(data.packages as Array<{
              id: string;
              title: string;
              location_summary: string | null;
              price: number | null;
              main_image: string | null;
            }>).map((pkg) => (
              <a
                key={pkg.id}
                href={`/packages/${pkg.id}?ref=${a.referral_code}`}
                className="block bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
              >
                {pkg.main_image ? (
                  <div className="aspect-[4/3] relative bg-gray-100">
                    <Image
                      src={pkg.main_image}
                      alt={pkg.title}
                      fill
                      className="object-cover"
                      sizes="200px"
                    />
                  </div>
                ) : (
                  <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                    이미지 없음
                  </div>
                )}
                <div className="p-2.5">
                  <p className="text-xs font-medium text-gray-800 line-clamp-2">{pkg.title}</p>
                  {pkg.price && (
                    <p className="text-xs font-bold mt-1" style={{ color: primaryColor }}>
                      {pkg.price.toLocaleString()}원~
                    </p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 카드뉴스 목록 */}
      {card_news.length > 0 && (
        <div className="max-w-md mx-auto px-4 py-4 pb-20">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 px-1">📱 카드뉴스</h2>
          <div className="grid grid-cols-2 gap-3">
            {card_news.map((cn) => (
              <a
                key={cn.id}
                href={`/share/card-news/${cn.id}`}
                className="block bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
              >
                {cn.thumbnail_url ? (
                  <div className="aspect-[9/16] relative bg-gray-100">
                    <Image
                      src={cn.thumbnail_url}
                      alt={cn.title}
                      fill
                      className="object-cover"
                      sizes="200px"
                    />
                  </div>
                ) : (
                  <div className="aspect-[9/16] bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center p-4">
                    <p className="text-xs text-gray-500 text-center line-clamp-4">{cn.title}</p>
                  </div>
                )}
                <div className="p-2.5">
                  <p className="text-xs font-medium text-gray-800 line-clamp-2">{cn.title}</p>
                  {cn.engagement_score != null && (
                    <p className="text-[10px] text-gray-500 mt-1">
                      👍 {cn.engagement_score.toFixed(0)}
                    </p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 푸터 */}
      <div className="text-center py-6 text-xs text-gray-400">
        <p>Powered by 여소남</p>
      </div>
    </div>
  );
}

/**
 * 색상을 어둡게/밝게 조정 (헥스 → -30/+30)
 */
function adjustColor(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
