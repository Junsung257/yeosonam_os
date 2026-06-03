import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type RecommendationRow = {
  package_id?: string;
  [key: string]: unknown;
};

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ success: true, algorithm: 'none', count: 0, recommendations: [] });
  }

  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customer_id');
    const destination = searchParams.get('destination');
    const algorithm = searchParams.get('algorithm') || 'auto';

    let recommendations: RecommendationRow[] = [];
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

    const sessionId = request.cookies.get('ys_session_id')?.value;
    if (recommendations.length > 0) {
      try {
        await supabaseAdmin
          .from('recommendation_logs')
          .insert({
            session_id: sessionId || null,
            customer_id: customerId || null,
            recommended_packages: recommendations.map((r: RecommendationRow) => r.package_id),
            algorithm: usedAlgorithm,
          });
      } catch {
        // fire-and-forget
      }
    }

    return apiResponse(
      {
        success: true,
        algorithm: usedAlgorithm,
        count: recommendations.length,
        recommendations,
      },
      {
        headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
      },
    );
  } catch (error) {
    console.error('[Recommendations] error:', sanitizeDbError(error));
    return apiResponse({ success: true, algorithm: 'error', count: 0, recommendations: [] });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ success: true });
  }

  try {
    const { sessionId, packageId } = await request.json();
    if (!sessionId || !packageId) {
      return apiResponse({ success: true });
    }

    await supabaseAdmin
      .from('recommendation_logs')
      .update({ clicked_package_id: packageId })
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1);

    return apiResponse({ success: true });
  } catch {
    return apiResponse({ success: true });
  }
}
