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
import { classifySearchIntent, intentPriorityDelta } from './blog-search-intent';
import { computeSeasonalTargetPublishAt } from './blog-season-publish';
import { CUSTOMER_VISIBLE_STATUSES } from './visibility-status';
import { normalizeBlogTopicQueueRow } from './blog-queue-normalize';
import { filterTopicFitPassed } from './blog-topic-fit-gate';
import {
  hasObservedProgrammaticKeywordDemand,
  selectDailyProgrammaticDemandProbe,
} from './blog-programmatic-demand';
import {
  buildProgrammaticQueueMeta,
  evaluateProgrammaticPromotionReadiness,
  getBlogProgrammaticContract,
} from './blog-programmatic-contract';
import type {
  BlogResearchOfficialDocumentCapability,
  BlogResearchRegistryCapability,
  BlogResearchReputableCapability,
} from './blog-research-capability';

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
      .in('status', [...CUSTOMER_VISIBLE_STATUSES]);
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
  demand_rejected: number;
  contract_rejected: number;
  human_review_rejected: number;
  coverage_rejected: number;
  representative_rejected: number;
  errors: string[];
}> {
  const limit = opts?.limit ?? 3;
  const errors: string[] = [];

  // 현재 월 + 다음 월 시즌성 우선
  const now = new Date();
  const thisMonth = now.getMonth() + 1;
  const nextMonth = thisMonth === 12 ? 1 : thisMonth + 1;

  // pending 토픽 fetch — 시즌성 매칭 우선
  const { data: candidates, error: candidatesError } = await supabaseAdmin
    .from('programmatic_seo_topics')
    .select('*')
    .eq('status', 'pending')
    .or(`month.is.null,month.eq.${thisMonth},month.eq.${nextMonth}`)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(500);

  if (candidatesError) {
    return {
      promoted: 0,
      demand_rejected: 0,
      contract_rejected: 0,
      human_review_rejected: 0,
      coverage_rejected: 0,
      representative_rejected: 0,
      errors: [`programmatic candidate lookup failed: ${candidatesError.message}`],
    };
  }

  if (!candidates || candidates.length === 0) {
    return {
      promoted: 0,
      demand_rejected: 0,
      contract_rejected: 0,
      human_review_rejected: 0,
      coverage_rejected: 0,
      representative_rejected: 0,
      errors: ['pending 토픽 없음'],
    };
  }

  // 14일 내 같은 (destination, primary_keyword) 큐 이력 — 중복 방어
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const { data: recent, error: recentError } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('destination, primary_keyword')
    .gte('created_at', since.toISOString());
  if (recentError) {
    return {
      promoted: 0,
      demand_rejected: 0,
      contract_rejected: 0,
      human_review_rejected: 0,
      coverage_rejected: 0,
      representative_rejected: 0,
      errors: [`programmatic recent queue lookup failed: ${recentError.message}`],
    };
  }
  const recentKeys = new Set(
    ((recent || []) as Array<{ destination: string | null; primary_keyword: string | null }>)
      .map(r => `${r.destination || ''}::${r.primary_keyword || ''}`)
  );

  const fresh = candidates.filter((c: any) =>
    !recentKeys.has(`${c.destination}::${c.primary_keyword}`)
  );

  if (fresh.length === 0) {
    return {
      promoted: 0,
      demand_rejected: 0,
      contract_rejected: 0,
      human_review_rejected: 0,
      coverage_rejected: 0,
      representative_rejected: 0,
      errors: ['모두 14일 dedup 충돌'],
    };
  }

  const probe = selectDailyProgrammaticDemandProbe(fresh, { limit });

  // 키워드 리서치
  const research = await researchKeywordsBatch(
    probe.map((c: Record<string, unknown>) => c.primary_keyword as string),
  ).catch(() => new Map());
  const demandBacked = probe.filter((candidate: Record<string, unknown>) =>
    hasObservedProgrammaticKeywordDemand(research.get(candidate.primary_keyword as string)),
  );
  const demandRejected = probe.length - demandBacked.length;

  if (demandBacked.length === 0) {
    return {
      promoted: 0,
      demand_rejected: demandRejected,
      contract_rejected: 0,
      human_review_rejected: 0,
      coverage_rejected: 0,
      representative_rejected: 0,
      errors,
    };
  }

  const [representativesResult, registriesResult, officialDocumentsResult, reputableSourcesResult] = await Promise.all([
    supabaseAdmin
      .from('blog_information_representatives')
      .select('representative_key')
      .eq('status', 'active')
      .limit(2000),
    supabaseAdmin
      .from('blog_information_official_source_registry')
      .select('id,source_type,status')
      .eq('status', 'active'),
    supabaseAdmin
      .from('blog_information_official_research_documents')
      .select('official_source_registry_id,source_url,intents,destinations,status')
      .eq('status', 'active'),
    supabaseAdmin
      .from('blog_information_reputable_source_registry')
      .select('source_types,intents,research_urls,research_destinations,status')
      .eq('status', 'active'),
  ]);
  const prerequisiteError = representativesResult.error
    ?? registriesResult.error
    ?? officialDocumentsResult.error
    ?? reputableSourcesResult.error;
  if (prerequisiteError) {
    errors.push(`programmatic prerequisite lookup failed: ${prerequisiteError.message}`);
    return {
      promoted: 0,
      demand_rejected: demandRejected,
      contract_rejected: 0,
      human_review_rejected: 0,
      coverage_rejected: 0,
      representative_rejected: 0,
      errors,
    };
  }

  const activeRepresentativeKeys = new Set(
    (representativesResult.data ?? [])
      .map(row => row.representative_key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0),
  );
  const registries = (registriesResult.data ?? []) as BlogResearchRegistryCapability[];
  const officialDocuments = (
    officialDocumentsResult.data ?? []
  ) as BlogResearchOfficialDocumentCapability[];
  const reputableSources = (
    reputableSourcesResult.data ?? []
  ) as BlogResearchReputableCapability[];
  let contractRejected = 0;
  let humanReviewRejected = 0;
  let coverageRejected = 0;
  let representativeRejected = 0;
  let topicFitRejected = 0;
  const queueRows: Record<string, unknown>[] = [];
  for (const c of demandBacked as Record<string, unknown>[]) {
    if (queueRows.length >= limit) break;
    const kw = c.primary_keyword as string;
    const topic = c.topic_template as string;
    const destination = c.destination as string;
    const angle = c.angle as string;
    const sourceId = c.id as string;
    const contract = getBlogProgrammaticContract(angle);
    const meta = buildProgrammaticQueueMeta({
      sourceId,
      angle,
      topic,
      month: typeof c.month === 'number' ? c.month : null,
    });
    if (!contract || !meta) {
      contractRejected += 1;
      continue;
    }
    const r = research.get(kw);
    const tier = r?.tier ?? c.expected_tier as string ?? classifyKeywordTier(kw);
    const intent = classifySearchIntent(
      `${kw ?? ''} ${(c.topic_template as string) ?? ''}`.trim(),
    );
    const basePriority =
      typeof c.priority === 'number' && !Number.isNaN(c.priority) ? c.priority : 50;
    const priority = Math.max(1, basePriority + intentPriorityDelta(intent));
    const seasonalAt = computeSeasonalTargetPublishAt(
      typeof c.month === 'number' ? c.month : null,
    );
    const queueRow = normalizeBlogTopicQueueRow({
      topic,
      source: 'coverage_gap',  // programmatic은 coverage gap 일종
      priority,
      destination,
      angle_type: angle,
      category: contract.category,
      primary_keyword: kw,
      keyword_tier: tier,
      monthly_search_volume: r?.monthly_search_volume ?? null,
      competition_level: r?.competition_level ?? (tier === 'head' ? 'high' : tier === 'mid' ? 'medium' : 'low'),
      ...(seasonalAt ? { target_publish_at: seasonalAt } : {}),
      meta: {
        ...meta,
        search_intent: intent,
        demand_verified_at: new Date().toISOString(),
        demand_signal_source: r?.monthly_search_volume
          ? 'naver_search_ads'
          : 'naver_datalab',
      },
    });
    const topicFit = filterTopicFitPassed([queueRow]);
    if (topicFit.rows.length === 0) {
      topicFitRejected += 1;
      continue;
    }
    const acceptedRow = topicFit.rows[0]!;
    const readiness = evaluateProgrammaticPromotionReadiness({
      topic,
      destination,
      primaryKeyword: kw,
      category: contract.category,
      source: 'coverage_gap',
      angleType: angle,
      meta: acceptedRow.meta,
      activeRepresentativeKeys,
      registries,
      officialDocuments,
      reputableSources,
    });
    if (!readiness.passed) {
      if (readiness.reason === 'human_review_required') humanReviewRejected += 1;
      else if (readiness.reason === 'research_coverage_missing') coverageRejected += 1;
      else if (readiness.reason === 'active_representative_exists') representativeRejected += 1;
      else contractRejected += 1;
      continue;
    }
    if (readiness.representativeKey) activeRepresentativeKeys.add(readiness.representativeKey);
    queueRows.push(acceptedRow);
  }

  const acceptedQueueRows = queueRows;
  if (topicFitRejected > 0) errors.push(`topic_fit_rejected: ${topicFitRejected}`);

  if (acceptedQueueRows.length === 0) {
    return {
      promoted: 0,
      demand_rejected: demandRejected,
      contract_rejected: contractRejected,
      human_review_rejected: humanReviewRejected,
      coverage_rejected: coverageRejected,
      representative_rejected: representativeRejected,
      errors,
    };
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .insert(acceptedQueueRows)
    .select('id, primary_keyword, meta');

  if (error) {
    errors.push(`큐 INSERT 실패: ${error.message}`);
    return {
      promoted: 0,
      demand_rejected: demandRejected,
      contract_rejected: contractRejected,
      human_review_rejected: humanReviewRejected,
      coverage_rejected: coverageRejected,
      representative_rejected: representativeRejected,
      errors,
    };
  }

  const observedAt = new Date();
  const expiresAt = new Date(observedAt.getTime() + 30 * 86_400_000).toISOString();
  const demandRows = (inserted ?? []).flatMap((row: Record<string, unknown>) => {
    const keyword = row.primary_keyword as string;
    const observed = research.get(keyword);
    const rows: Record<string, unknown>[] = [];
    if (Number(observed?.monthly_search_volume ?? 0) > 0) {
      rows.push({
        queue_id: row.id,
        provider: 'search_volume',
        signal_key: keyword,
        signal_value: observed!.monthly_search_volume,
        source_reference: `keyword_research_cache:${row.id}:volume`,
        observed_at: observedAt.toISOString(),
        expires_at: expiresAt,
        metadata: { keyword, source: observed?.source },
      });
    }
    if (Number(observed?.trend_score ?? 0) > 0) {
      rows.push({
        queue_id: row.id,
        provider: 'search_trend',
        signal_key: keyword,
        signal_value: observed!.trend_score,
        source_reference: `keyword_research_cache:${row.id}:trend`,
        observed_at: observedAt.toISOString(),
        expires_at: expiresAt,
        metadata: { keyword, source: observed?.source },
      });
    }
    return rows;
  });
  const { error: demandError } = await supabaseAdmin
    .from('blog_demand_signals')
    .insert(demandRows);
  if (demandError) {
    const insertedIds = (inserted ?? []).map((row: Record<string, unknown>) => row.id as string);
    if (insertedIds.length > 0) {
      await supabaseAdmin.from('blog_topic_queue').delete().in('id', insertedIds);
    }
    errors.push(`수요 근거 저장 실패: ${demandError.message}`);
    return {
      promoted: 0,
      demand_rejected: demandRejected,
      contract_rejected: contractRejected,
      human_review_rejected: humanReviewRejected,
      coverage_rejected: coverageRejected,
      representative_rejected: representativeRejected,
      errors,
    };
  }

  // pending → queued 처리
  let promoted = 0;
  if (inserted && inserted.length > 0) {
    for (const insertedRow of inserted) {
      const ins = insertedRow as Record<string, unknown>;
      const rowMeta = ins.meta && typeof ins.meta === 'object' && !Array.isArray(ins.meta)
        ? ins.meta as Record<string, unknown>
        : null;
      const sourceId = typeof rowMeta?.programmatic_source_id === 'string'
        ? rowMeta.programmatic_source_id
        : null;
      const updateResult = sourceId
        ? await supabaseAdmin
        .from('programmatic_seo_topics')
        .update({
          status: 'queued',
          promoted_at: new Date().toISOString(),
          topic_queue_id: ins.id,
        })
        .eq('id', sourceId)
        .eq('status', 'pending')
        .select('id')
        : { data: null, error: new Error('programmatic_source_id missing') };
      if (!updateResult.error && (updateResult.data?.length ?? 0) === 1) {
        promoted += 1;
        continue;
      }
      await supabaseAdmin.from('blog_demand_signals').delete().eq('queue_id', ins.id);
      await supabaseAdmin.from('blog_topic_queue').delete().eq('id', ins.id);
      errors.push(`programmatic source transition failed: ${sourceId ?? 'missing'}:${updateResult.error?.message ?? 'pending row not claimed'}`);
    }
  }

  return {
    promoted,
    demand_rejected: demandRejected,
    contract_rejected: contractRejected,
    human_review_rejected: humanReviewRejected,
    coverage_rejected: coverageRejected,
    representative_rejected: representativeRejected,
    errors,
  };
}
