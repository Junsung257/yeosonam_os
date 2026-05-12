import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import PoliciesClient, { type Policy } from './PoliciesClient';

/**
 * /admin/publishing-policies — 발행 정책 어드민 (admin-guarded plural 버전)
 *
 * 기존 /admin/blog/policy 와 같은 publishing_policies 테이블을 다루지만:
 *   - SSR 으로 초기 데이터 페치 (깜빡임 0)
 *   - admin-dashboard-review 체크리스트 준수: KPI 산식 명시(정보성/상품 합계, 일·주 환산),
 *     접근성(label htmlFor·aria-describedby), 강조 색상은 화면당 1곳
 *   - admin-guard 적용된 plural API 사용
 *
 * NOTE(중복 정리 후보): 기존 /admin/blog/policy + /api/admin/publishing-policy(singular) 와
 * 데이터 소스가 동일. 메뉴 통합/리다이렉트 여부는 PR 리뷰에서 결정.
 *
 * 페이지 자체 권한 체크는 middleware + 어드민 레이아웃에서 처리되지만,
 * 안전망으로 PATCH·GET API는 admin-guard 로 또 한 번 막혀 있음.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function loadPolicies(): Promise<Policy[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabaseAdmin
    .from('publishing_policies')
    .select('*')
    .order('scope', { ascending: true });
  if (error) {
    console.error('[publishing-policies] SSR fetch error:', error.message);
    return [];
  }
  return (data ?? []) as Policy[];
}

export default async function PublishingPoliciesPage() {
  const initial = await loadPolicies();
  return <PoliciesClient initial={initial} configured={isSupabaseConfigured} />;
}
