import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { applyCommissionPolicies, summarizeBreakdown } from '@/lib/policy-engine';

// 어필리에이트 커미션 정책 미리보기:
// 활성 어필리에이터 N명 + 활성 상품 M개에 대해 평균 커미션율과 월 정산 영향 추정.
// 사장님이 정책 활성화 전에 "지금 켜면 무슨 일이?"를 5초 안에 확인할 수 있도록.
//
// ⚠️ 어필리에이터 이름·평균 커미션율 등 민감 데이터를 반환하므로 admin-only.
//   middleware는 /api 경로를 인증 보호하지만(/api/policies/preview는 PUBLIC_PATHS 미등록),
//   추가로 service-role 토큰 또는 admin 쿠키를 직접 검증한다.

function isAdmin(req: NextRequest): boolean {
  // middleware의 admin 인증을 통과하면 supabase admin 쿠키가 존재
  const adminCookie = req.cookies.get('sb-admin')?.value
    || req.cookies.get('admin_email')?.value;
  if (adminCookie) return true;
  // service role 헤더 (서버-to-서버 호출용)
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ') && process.env.SUPABASE_SERVICE_ROLE_KEY
      && auth.slice(7) === process.env.SUPABASE_SERVICE_ROLE_KEY) return true;
  return false;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!isAdmin(request)) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    const { searchParams } = request.nextUrl;
    const sample = parseInt(searchParams.get('sample') || '20', 10);
    const productId = searchParams.get('product_id');

    const [{ data: affs }, { data: pkgs }] = await Promise.all([
      supabaseAdmin
        .from('affiliates')
        .select('id, name, grade, bonus_rate, created_at')
        .eq('is_active', true)
        .limit(sample),
      productId
        ? supabaseAdmin
            .from('travel_packages')
            .select('id, title, destination, affiliate_commission_rate')
            .eq('id', productId)
            .limit(1)
        : supabaseAdmin
            .from('travel_packages')
            .select('id, title, destination, affiliate_commission_rate')
            .eq('status', 'approved')
            .limit(sample),
    ]);

    const affiliates = (affs || []) as Array<{
      id: string;
      name: string;
      grade: number | null;
      bonus_rate: number;
      created_at: string;
    }>;
    const packages = (pkgs || []) as Array<{
      id: string;
      title: string;
      destination: string;
      affiliate_commission_rate: number;
    }>;

    const samples: Array<{
      affiliate: string;
      product: string;
      breakdown: Awaited<ReturnType<typeof applyCommissionPolicies>>;
      summary: string;
    }> = [];

    for (const aff of affiliates.slice(0, 5)) {
      for (const pkg of packages.slice(0, 3)) {
        const daysSinceSignup = aff.created_at
          ? Math.max(0, Math.floor((Date.now() - new Date(aff.created_at).getTime()) / 86400000))
          : 0;
        const breakdown = await applyCommissionPolicies({
          product_id: pkg.id,
          destination: pkg.destination,
          affiliate_id: aff.id,
          affiliate_grade: aff.grade ?? 1,
          days_since_signup: daysSinceSignup,
          base_rate: Number(pkg.affiliate_commission_rate) || 0.02,
          tier_bonus: aff.bonus_rate || 0,
        });
        samples.push({
          affiliate: aff.name,
          product: pkg.title,
          breakdown,
          summary: summarizeBreakdown(breakdown),
        });
      }
    }

    const avgFinal =
      samples.length > 0
        ? samples.reduce((s, x) => s + x.breakdown.final_rate, 0) / samples.length
        : 0;

    return NextResponse.json({
      affiliate_count: affiliates.length,
      product_count: packages.length,
      sample_size: samples.length,
      avg_final_rate: Math.round(avgFinal * 10000) / 10000,
      avg_final_pct: `${(avgFinal * 100).toFixed(2)}%`,
      capped_count: samples.filter(s => s.breakdown.capped).length,
      samples: samples.slice(0, 10),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '미리보기 실패' },
      { status: 500 },
    );
  }
}
