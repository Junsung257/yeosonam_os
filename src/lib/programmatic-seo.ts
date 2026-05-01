/**
 * Programmatic SEO Matrix — destination × angle × month 사전 토픽 양산
 *
 * 컨셉 (Clearbit/Webflow/Zapier 검증):
 *   "특정 패턴으로 N×M×K URL 사전 양산 → long-tail 검색 의도 망 짠다"
 *   각 URL은 독립적 검색 의도 보유 (예: "다낭 6월 우기 옷차림" vs "다낭 6월 옷차림" vs "다낭 옷차림")
 *
 * Matrix:
 *   destination (활성 카탈로그 ~20개) ×
 *   angle (12개) ×
 *   month (1~12, 시즌성 angle만)
 *
 * = 안전 발행량: 한 destination당 ~30-60 토픽. 전체 600-1200개.
 *   하루 8편 발행 = 75~150일 분량 (장기 SEO 자산)
 *
 * 흐름:
 *   1) seedProgrammaticTopics() — 빈 매트릭스를 programmatic_seo_topics에 시드
 *   2) 매일 cron이 N개씩 status='pending' → blog_topic_queue로 이전 (priority=50)
 *   3) 발행 후 used 처리
 */

import { supabaseAdmin } from './supabase';
import { researchKeywordsBatch, classifyKeywordTier } from './keyword-research';

// 12 angle × 시즌 적합도
interface AngleTemplate {
  angle: string;
  topic_template: (dest: string, month?: number) => string;
  primary_keyword: (dest: string, month?: number) => string;
  monthly: boolean;  // 월별 변형 생성 여부
  priority: number;
}

const ANGLE_TEMPLATES: AngleTemplate[] = [
  {
    angle: 'weather',
    topic_template: (d, m) => m ? `${d} ${m}월 날씨와 옷차림 완벽 가이드` : `${d} 월별 날씨와 옷차림`,
    primary_keyword: (d, m) => m ? `${d} ${m}월 날씨` : `${d} 날씨`,
    monthly: true,
    priority: 65,
  },
  {
    angle: 'budget',
    topic_template: d => `${d} 3박4일 예상 총비용과 절약 팁`,
    primary_keyword: d => `${d} 여행 비용`,
    monthly: false,
    priority: 60,
  },
  {
    angle: 'itinerary_3d',
    topic_template: d => `${d} 3박4일 추천 일정과 동선`,
    primary_keyword: d => `${d} 3박4일 일정`,
    monthly: false,
    priority: 60,
  },
  {
    angle: 'itinerary_5d',
    topic_template: d => `${d} 4박5일 추천 일정과 코스`,
    primary_keyword: d => `${d} 4박5일`,
    monthly: false,
    priority: 55,
  },
  {
    angle: 'food',
    topic_template: d => `${d} 현지 맛집 BEST와 꼭 먹어야 할 음식`,
    primary_keyword: d => `${d} 맛집`,
    monthly: false,
    priority: 60,
  },
  {
    angle: 'visa',
    topic_template: d => `${d} 비자·입국 서류 필요 여부 정리`,
    primary_keyword: d => `${d} 비자`,
    monthly: false,
    priority: 50,
  },
  {
    angle: 'transport',
    topic_template: d => `${d} 공항에서 시내 이동 방법`,
    primary_keyword: d => `${d} 공항 이동`,
    monthly: false,
    priority: 50,
  },
  {
    angle: 'currency',
    topic_template: d => `${d} 화폐·환전·팁 문화 총정리`,
    primary_keyword: d => `${d} 환전`,
    monthly: false,
    priority: 45,
  },
  {
    angle: 'season_best',
    topic_template: (d, m) => m ? `${m}월 ${d} 여행 어떨까 — 장단점 분석` : `${d} 여행 가기 좋은 시기`,
    primary_keyword: (d, m) => m ? `${m}월 ${d}` : `${d} 베스트 시즌`,
    monthly: true,
    priority: 60,
  },
  {
    angle: 'family',
    topic_template: d => `${d} 가족여행 추천 — 아이와 함께 갈 만한 곳`,
    primary_keyword: d => `${d} 가족여행`,
    monthly: false,
    priority: 55,
  },
  {
    angle: 'honeymoon',
    topic_template: d => `${d} 신혼여행 추천 코스와 호텔`,
    primary_keyword: d => `${d} 신혼여행`,
    monthly: false,
    priority: 60,
  },
  {
    angle: 'filial',
    topic_template: d => `${d} 효도여행 — 부모님 모시고 갈 만한지`,
    primary_keyword: d => `${d} 효도여행`,
    monthly: false,
    priority: 55,
  },
];

/**
 * 활성 destination × 12 angle × (월별 4개) 매트릭스 시드
 * UNIQUE(destination,angle,month) 충돌은 무시 — idempotent
 */
export async function seedProgrammaticTopics(opts?: { destinations?: string[] }): Promise<{
  destinations: number;
  inserted: number;
  total_attempted: number;
}> {
  let destinations = opts?.destinations;
  if (!destinations) {
    const { data } = await supabaseAdmin
      .from('travel_packages')
      .select('destination')
      .in('status', ['approved', 'active']);
    destinations = Array.from(new Set(
      ((data || []) as Array<{ destination: string | null }>)
        .map(p => p.destination)
        .filter((d): d is string => Boolean(d))
    ));
  }
  if (destinations.length === 0) return { destinations: 0, inserted: 0, total_attempted: 0 };

  // 시즌성 월: 6/8/10/12 (4개)
  const seasonalMonths = [3, 6, 9, 12];
  const rows: any[] = [];

  for (const dest of destinations) {
    for (const tpl of ANGLE_TEMPLATES) {
      if (tpl.monthly) {
        for (const m of seasonalMonths) {
          rows.push({
            destination: dest,
            angle: tpl.angle,
            month: m,
            topic_template: tpl.topic_template(dest, m),
            primary_keyword: tpl.primary_keyword(dest, m),
            priority: tpl.priority,
            status: 'pending',
          });
        }
      } else {
        rows.push({
          destination: dest,
          angle: tpl.angle,
          month: null,
          topic_template: tpl.topic_template(dest),
          primary_keyword: tpl.primary_keyword(dest),
          priority: tpl.priority,
          status: 'pending',
        });
      }
    }
  }

  // 일괄 INSERT — 중복은 ON CONFLICT 무시
  let inserted = 0;
  // 200개씩 배치
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { data: ins } = await supabaseAdmin
      .from('programmatic_seo_topics')
      .upsert(batch, { onConflict: 'destination,angle,month', ignoreDuplicates: true })
      .select('id');
    inserted += ins?.length ?? 0;
  }

  return {
    destinations: destinations.length,
    inserted,
    total_attempted: rows.length,
  };
}

/**
 * 매일 cron이 호출 — pending 매트릭스에서 N개를 blog_topic_queue로 승격
 * 시즌성 우선 (현재 월 ± 1 month) → priority 순
 */
export async function promotePendingTopics(opts?: { limit?: number }): Promise<{
  promoted: number;
  errors: string[];
}> {
  const limit = opts?.limit ?? 3;
  const errors: string[] = [];

  // 현재 월 + 다음 월 시즌성 우선
  const now = new Date();
  const thisMonth = now.getMonth() + 1;
  const nextMonth = thisMonth === 12 ? 1 : thisMonth + 1;

  // pending 토픽 fetch — 시즌성 매칭 우선
  const { data: candidates } = await supabaseAdmin
    .from('programmatic_seo_topics')
    .select('*')
    .eq('status', 'pending')
    .or(`month.is.null,month.eq.${thisMonth},month.eq.${nextMonth}`)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit * 2);  // 후보 여유

  if (!candidates || candidates.length === 0) {
    return { promoted: 0, errors: ['pending 토픽 없음'] };
  }

  // 14일 내 같은 (destination, primary_keyword) 큐 이력 — 중복 방어
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const { data: recent } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('destination, primary_keyword')
    .gte('created_at', since.toISOString());
  const recentKeys = new Set(
    ((recent || []) as Array<{ destination: string | null; primary_keyword: string | null }>)
      .map(r => `${r.destination || ''}::${r.primary_keyword || ''}`)
  );

  const fresh = candidates.filter((c: any) =>
    !recentKeys.has(`${c.destination}::${c.primary_keyword}`)
  ).slice(0, limit);

  if (fresh.length === 0) return { promoted: 0, errors: ['모두 14일 dedup 충돌'] };

  // 키워드 리서치
  const research = await researchKeywordsBatch(fresh.map((c: any) => c.primary_keyword)).catch(() => new Map());

  const queueRows: any[] = [];
  for (const c of fresh as any[]) {
    const r = research.get(c.primary_keyword);
    const tier = r?.tier ?? c.expected_tier ?? classifyKeywordTier(c.primary_keyword);
    queueRows.push({
      topic: c.topic_template,
      source: 'coverage_gap',  // programmatic은 coverage gap 일종
      priority: c.priority,
      destination: c.destination,
      category: 'travel_tips',
      primary_keyword: c.primary_keyword,
      keyword_tier: tier,
      monthly_search_volume: r?.monthly_search_volume ?? null,
      competition_level: r?.competition_level ?? (tier === 'head' ? 'high' : tier === 'mid' ? 'medium' : 'low'),
      meta: {
        programmatic_source_id: c.id,
        programmatic_angle: c.angle,
        programmatic_month: c.month,
      },
    });
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .insert(queueRows)
    .select('id, primary_keyword');

  if (error) {
    errors.push(`큐 INSERT 실패: ${error.message}`);
    return { promoted: 0, errors };
  }

  // pending → queued 처리
  if (inserted && inserted.length > 0) {
    for (let i = 0; i < inserted.length; i++) {
      const ins = inserted[i] as any;
      const src = fresh.find((f: any) => f.primary_keyword === ins.primary_keyword);
      if (!src) continue;
      await supabaseAdmin
        .from('programmatic_seo_topics')
        .update({
          status: 'queued',
          promoted_at: new Date().toISOString(),
          topic_queue_id: ins.id,
        })
        .eq('id', src.id);
    }
  }

  return { promoted: inserted?.length ?? 0, errors };
}
