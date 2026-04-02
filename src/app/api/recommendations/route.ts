import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

// GET /api/recommendations?customer_id=&destination=&algorithm=
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: true, algorithm: 'none', count: 0, recommendations: [] });
  }

  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customer_id');
    const destination = searchParams.get('destination');
    const algorithm = searchParams.get('algorithm') || 'auto';

    let recommendations: any[] = [];
    let usedAlgorithm = 'trending';

    if (algorithm === 'auto') {
      if (destination) {
        const { data } = await supabaseAdmin.rpc('get_personalized_by_destination', {
          p_customer_id: customerId || null,
          p_destination: destination,
        });
        recommendations = data || [];
        usedAlgorithm = 'personalized';
      } else if (customerId) {
        const { data } = await supabaseAdmin.rpc('get_simple_recommendations', {
          p_customer_id: customerId,
        });
        recommendations = data || [];
        usedAlgorithm = 'similar_customers';
      } else {
        const { data } = await supabaseAdmin.rpc('get_trending_packages');
        recommendations = data || [];
        usedAlgorithm = 'trending';
      }
    } else if (algorithm === 'trending') {
      const { data } = await supabaseAdmin.rpc('get_trending_packages');
      recommendations = data || [];
      usedAlgorithm = 'trending';
    } else {
      const { data } = await supabaseAdmin.rpc('get_simple_recommendations', {
        p_customer_id: customerId || null,
      });
      recommendations = data || [];
      usedAlgorithm = algorithm;
    }

    // 추천 로그 저장 (fire-and-forget)
    const sessionId = request.cookies.get('ys_session_id')?.value;
    if (recommendations.length > 0) {
      supabaseAdmin
        .from('recommendation_logs')
        .insert({
          session_id: sessionId || null,
          customer_id: customerId || null,
          recommended_packages: recommendations.map((r: any) => r.package_id),
          algorithm: usedAlgorithm,
        })
        .then(() => {})
        .catch(() => {});
    }

    return NextResponse.json({
      success: true,
      algorithm: usedAlgorithm,
      count: recommendations.length,
      recommendations,
    });
  } catch (error) {
    console.error('[Recommendations] 오류:', error);
    return NextResponse.json({ success: true, algorithm: 'error', count: 0, recommendations: [] });
  }
}

// POST /api/recommendations — 추천 클릭 로깅
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: true });
  }

  try {
    const { sessionId, packageId } = await request.json();
    if (!sessionId || !packageId) {
      return NextResponse.json({ success: true });
    }

    await supabaseAdmin
      .from('recommendation_logs')
      .update({ clicked_package_id: packageId })
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}
