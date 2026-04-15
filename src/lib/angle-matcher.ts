/**
 * 앵글(가성비/감성/효도/럭셔리/긴급특가/액티비티/미식)에 맞는 추천 상품 매칭 룰.
 * 블로그의 /blog/angle/[angle] 카테고리 페이지에서 사용.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export interface AnglePackage {
  id: string;
  title: string;
  destination: string | null;
  price: number | null;
  product_type: string | null;
  product_highlights: string[] | null;
  ticketing_deadline: string | null;
  display_title: string | null;
}

const SELECT_FIELDS =
  'id, title, destination, price, product_type, product_highlights, ticketing_deadline, display_title';

const KEYWORD_RULES: Record<string, RegExp> = {
  emotional: /감성|뷰|일몰|온천|벚꽃|단풍|야경|로맨틱|풍경/,
  filial:    /효도|부모님|시니어|어르신|편안|여유/,
  activity:  /골프|액티비티|트래킹|등산|스키|스노쿨링|다이빙|서핑|체험/,
  food:      /미식|맛집|현지식|시그니처|프리미엄.*식|먹방|요리/,
};

const PREMIUM_TYPE = /프리미엄|고품격|럭셔리|VIP/;
const VALUE_TYPE   = /실속|가성비|노팁|특가/;

function matchesKeyword(pkg: AnglePackage, regex: RegExp): boolean {
  const haystack = [
    pkg.title || '',
    pkg.display_title || '',
    pkg.product_type || '',
    ...(pkg.product_highlights || []),
  ].join(' ');
  return regex.test(haystack);
}

/**
 * 앵글에 맞는 추천 상품 6개 반환.
 * 각 앵글마다 다른 정렬/필터 룰 적용.
 */
export async function getPackagesByAngle(angle: string, limit = 6): Promise<AnglePackage[]> {
  if (!isSupabaseConfigured) return [];

  try {
    // 일단 충분히 가져와서 클라이언트 사이드에서 매칭/정렬 (DB JSONB 검색은 비용 큼)
    const { data } = await supabaseAdmin
      .from('travel_packages')
      .select(SELECT_FIELDS)
      .in('status', ['active', 'approved'])
      .not('price', 'is', null)
      .order('created_at', { ascending: false })
      .limit(120);

    const all = (data || []) as AnglePackage[];

    switch (angle) {
      case 'value':
        // 가성비: 가격 낮은순 + VALUE_TYPE 우선
        return [
          ...all.filter(p => p.product_type && VALUE_TYPE.test(p.product_type)),
          ...all.filter(p => !p.product_type || !VALUE_TYPE.test(p.product_type)),
        ]
          .filter(p => (p.price || 0) > 0)
          .sort((a, b) => (a.price || 0) - (b.price || 0))
          .slice(0, limit);

      case 'luxury':
        // 럭셔리: 프리미엄 타입 우선 + 가격 높은순
        return [
          ...all.filter(p => p.product_type && PREMIUM_TYPE.test(p.product_type)),
          ...all.filter(p => !p.product_type || !PREMIUM_TYPE.test(p.product_type))
            .sort((a, b) => (b.price || 0) - (a.price || 0)),
        ].slice(0, limit);

      case 'urgency': {
        // 긴급특가: ticketing_deadline 임박 + 가격 낮은순
        const today = new Date().toISOString().slice(0, 10);
        return all
          .filter(p => p.ticketing_deadline && p.ticketing_deadline >= today)
          .sort((a, b) => (a.ticketing_deadline || '').localeCompare(b.ticketing_deadline || ''))
          .slice(0, limit);
      }

      case 'emotional':
      case 'filial':
      case 'activity':
      case 'food': {
        const regex = KEYWORD_RULES[angle];
        const matched = all.filter(p => matchesKeyword(p, regex));
        if (matched.length >= limit) return matched.slice(0, limit);
        // 키워드 매칭이 부족하면 최신 상품으로 채움
        const remaining = all.filter(p => !matched.includes(p)).slice(0, limit - matched.length);
        return [...matched, ...remaining];
      }

      default:
        return all.slice(0, limit);
    }
  } catch {
    return [];
  }
}
