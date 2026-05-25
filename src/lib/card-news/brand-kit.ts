/**
 * Brand Kit — 테넌트/어필리에이터 브랜드 관리
 *
 * 카드뉴스, 블로그, 소셜 미디어 콘텐츠에 브랜드 일관성 적용.
 */
import { supabaseAdmin } from '@/lib/supabase';

export type BrandKitOwnerType = 'tenant' | 'affiliate' | 'platform';

export interface BrandKit {
  id: string;
  owner_type: BrandKitOwnerType;
  owner_id: string;
  name: string;
  primary_color: string;
  accent_color: string;
  background_color: string;
  font_family: string;
  logo_url: string | null;
  logo_light_url: string | null;
  brand_name: string;
  brand_tagline: string | null;
  watermark_text: string | null;
  watermark_enabled: boolean;
  social_links: Record<string, string>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const DEFAULT_BRAND: Omit<BrandKit, 'id' | 'created_at' | 'updated_at' | 'owner_type' | 'owner_id'> = {
  name: '여소남',
  primary_color: '#001f3f',
  accent_color: '#005d90',
  background_color: '#f8f9fb',
  font_family: 'Pretendard',
  logo_url: null,
  logo_light_url: null,
  brand_name: '여소남',
  brand_tagline: '믿을 수 있는 여행 파트너',
  watermark_text: '여소남 제공',
  watermark_enabled: true,
  social_links: {},
  is_active: true,
};

/**
 * 브랜드 킷 조회 (owner_type + owner_id)
 */
export async function getBrandKit(
  ownerType: BrandKitOwnerType,
  ownerId: string,
): Promise<BrandKit | null> {
  const { data, error } = await supabaseAdmin
    .from('brand_kits')
    .select('*')
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (error) {
    console.error('[brand-kit] 조회 실패:', error.message);
    return null;
  }
  return data as BrandKit | null;
}

/**
 * 브랜드 킷 생성 또는 업데이트
 */
export async function upsertBrandKit(
  ownerType: BrandKitOwnerType,
  ownerId: string,
  overrides: Partial<Omit<BrandKit, 'id' | 'created_at' | 'updated_at' | 'owner_type' | 'owner_id'>>,
): Promise<BrandKit | null> {
  const payload = {
    owner_type: ownerType,
    owner_id: ownerId,
    ...DEFAULT_BRAND,
    ...overrides,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('brand_kits')
    .upsert(payload, { onConflict: 'owner_type,owner_id' })
    .select()
    .single();

  if (error) {
    console.error('[brand-kit] upsert 실패:', error.message);
    return null;
  }
  return data as BrandKit;
}

/**
 * 카드뉴스 렌더링용 브랜드 오버라이드 생성
 */
export function buildBrandOverrides(brandKit: BrandKit | null, brandingLevel?: string): {
  logoUrl?: string;
  brandName?: string;
  accentColor?: string;
  watermark?: string;
} {
  if (!brandKit) return {};

  const overrides: {
    logoUrl?: string;
    brandName?: string;
    accentColor?: string;
    watermark?: string;
  } = {};

  if (brandKit.logo_url) overrides.logoUrl = brandKit.logo_url;
  overrides.brandName = brandKit.brand_name || undefined;
  overrides.accentColor = brandKit.accent_color || undefined;

  // 브랜딩 레벨에 따른 워터마크
  if (brandingLevel === 'powered_by' && brandKit.watermark_enabled) {
    overrides.watermark = brandKit.watermark_text || '여소남 제공';
  } else if (brandingLevel === 'co_brand' && brandKit.watermark_enabled) {
    overrides.watermark = `여소남 × ${brandKit.brand_name}`;
  }
  // white_label은 워터마크 없음

  return overrides;
}

/**
 * 어필리에이터의 브랜드 킷 조회 (없으면 기본 생성)
 */
export async function getAffiliateBrandKit(affiliateId: string): Promise<BrandKit | null> {
  const existing = await getBrandKit('affiliate', affiliateId);
  if (existing) return existing;

  // 어필리에이터 정보 조회
  const { data: affiliate } = await supabaseAdmin
    .from('affiliates')
    .select('name, logo_url')
    .eq('id', affiliateId)
    .single();

  if (!affiliate) return null;

  return upsertBrandKit('affiliate', affiliateId, {
    brand_name: affiliate.name || '',
    logo_url: affiliate.logo_url || null,
  });
}

/**
 * 테넌트의 브랜드 킷 조회 (없으면 기본 생성)
 */
export async function getTenantBrandKit(tenantId: string): Promise<BrandKit | null> {
  const existing = await getBrandKit('tenant', tenantId);
  if (existing) return existing;

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single();

  if (!tenant) return null;

  return upsertBrandKit('tenant', tenantId, {
    brand_name: tenant.name || '',
  });
}
