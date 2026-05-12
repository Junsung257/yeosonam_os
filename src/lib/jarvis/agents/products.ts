import { supabaseAdmin } from '@/lib/supabase'
import { PRODUCTS_PROMPT } from '../prompts'
import { AgentRunParams, AgentRunResult } from '../types'
import { runDeepSeekAgentLoop } from '../deepseek-agent-loop'
import { recommendBestPackages } from '@/lib/scoring/recommend'
import { getActivePolicy } from '@/lib/scoring/policy'

const PRODUCTS_TOOLS_RAW = [
  {
    name: 'search_packages',
    description: '패키지 목록을 검색합니다. 목적지, 날짜, 예산으로 필터링 가능합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        destination: { type: 'string', description: '목적지 (예: 장가계, 다낭, 방콕)' },
        departure_from: { type: 'string', description: '출발일 시작 (YYYY-MM-DD)' },
        departure_to: { type: 'string', description: '출발일 끝 (YYYY-MM-DD)' },
        min_price: { type: 'number', description: '최소 가격' },
        max_price: { type: 'number', description: '최대 가격' },
        status: { type: 'string', description: '상품 상태 (ACTIVE/DRAFT 등)' },
        limit: { type: 'number', description: '조회 개수 (기본 10)' }
      }
    }
  },
  {
    name: 'get_package_detail',
    description: '패키지 상세 정보와 일정표를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      required: ['package_id'],
      properties: {
        package_id: { type: 'string', description: '패키지 ID (UUID)' }
      }
    }
  },
  {
    name: 'get_package_hotel_mrt_cache',
    description:
      'DB에 저장된 MRT 호텔 동기화(어메니티·평점·취소규정 요약·체크인 시간 등). Wi‑Fi/조식 층 등 API에 있는 범위만 답변 가능. 없으면 /admin에서 MRT 동기화 후 재시도.',
    input_schema: {
      type: 'object' as const,
      required: ['package_id'],
      properties: {
        package_id: { type: 'string', description: '패키지 UUID' },
        departure_date: { type: 'string', description: '출발일 YYYY-MM-DD (선택 — 미지정 시 전체 출발일 행)' },
      },
    },
  },
  {
    name: 'recommend_package',
    description: '조건에 맞는 상품을 최대 3개 추천합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        destination: { type: 'string' },
        month: { type: 'string', description: '여행 월 (예: 5월)' },
        budget_per_person: { type: 'number' },
        adult_count: { type: 'number' },
        preferences: { type: 'string', description: '선호사항 (골프, 휴양, 쇼핑 등)' }
      }
    }
  },
  {
    name: 'recommend_best_packages',
    description: '같은 목적지·날짜 그룹 내 베스트 상품을 점수 기반으로 추천. Effective Price(헤도닉 환산가) + TOPSIS 알고리즘. 옵션 무료 포함, 호텔 등급, 직항, 식사, 쇼핑 횟수가 자동 환산됨. 답변에는 점수 숫자 노출 금지 — breakdown.why 의 자연어 사유만 사용. intent별 정책 ID 사용 가능 (가족/커플/효도/가성비/노옵션).',
    input_schema: {
      type: 'object' as const,
      required: ['destination'],
      properties: {
        destination: { type: 'string', description: '목적지 (예: 다낭, 장가계)' },
        departure_date: { type: 'string', description: '출발일 YYYY-MM-DD (생략 가능)' },
        departure_window_days: { type: 'number', description: '출발일 ±N일 묶기 (기본 3)' },
        duration_days: { type: 'number', description: '일정 길이(일) 필터' },
        limit: { type: 'number', description: '반환 개수 (기본 3)' },
        intent: { type: 'string', description: '추천 의도 (family/couple/filial/budget/no-option). outcomes 트래킹용' },
        policy_id: { type: 'string', description: '정책 UUID — intent에 맞는 가중치 정책. 미지정 시 활성 정책' },
        session_id: { type: 'string', description: '세션 ID — outcomes 트래킹 매핑용' },
      },
    },
  },
  {
    name: 'get_scoring_policy',
    description: '현재 활성 점수 정책(가중치, 호텔 프리미엄, 헤도닉 implicit price)을 조회. 추천 사유 설명 시 참고용.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'activate_policy',
    description: '정책을 active로 전환 (HITL 필요 — 사장님 승인 후 호출). policy_winner alert 받은 후 사용. 기존 active는 자동 비활성. recompute trigger 자동.',
    input_schema: {
      type: 'object' as const,
      required: ['policy_id'],
      properties: {
        policy_id: { type: 'string', description: '활성으로 전환할 정책 UUID' },
        reason: { type: 'string', description: '전환 사유 (admin_alerts message에 박힘)' },
      },
    },
  },
  {
    name: 'ack_alert',
    description: '운영 알림(admin_alert) 확인 처리. 사장님이 "확인했어" / "처리해" 하면 호출. 알림 ID 또는 ref(category+ref_id)로 매칭.',
    input_schema: {
      type: 'object' as const,
      properties: {
        alert_id: { type: 'number', description: '알림 ID (가장 정확)' },
        category: { type: 'string', description: 'category 매칭 (alert_id 없을 때)' },
        ref_type: { type: 'string', description: 'ref_type 매칭 (alert_id 없을 때)' },
        ref_id: { type: 'string', description: 'ref_id 매칭 (alert_id 없을 때)' },
      },
    },
  },
  {
    name: 'top_recommended_packages',
    description: '점수 시스템 상위 N개 패키지 조회 — 광고/콘텐츠 자동화 시점 어떤 패키지 우선할지. 그룹 1위 + 검증 패키지만.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: '기본 20' },
        destination: { type: 'string', description: '특정 destination 필터' },
        departure_from: { type: 'string', description: 'YYYY-MM-DD' },
        departure_to: { type: 'string', description: 'YYYY-MM-DD' },
        max_rank: { type: 'number', description: '최대 순위 (기본 1=1위만, 3=탑3)' },
      },
    },
  },
  {
    name: 'list_admin_alerts',
    description: '미해결 admin 알림 목록 — 정책 winner 발견·패키지 features 변경·LTR ready 등. 사장님이 "알림 있어?" / "뭐 새로운 거 있어?" 물으면 호출.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'policy_winner | feature_change | ltr_ready | general (생략 시 모두)' },
        limit: { type: 'number', description: '기본 10' },
      },
    },
  },
  {
    name: 'recommend_compare_pair',
    description: '같은 출발일 그룹의 두 패키지 1대1 비교 — 자연어 차이 합성 ("10만 비싸지만 5성+마사지 포함"). 사용자가 "A vs B 비교" 요청 시 호출.',
    input_schema: {
      type: 'object' as const,
      required: ['package_id_a', 'package_id_b'],
      properties: {
        package_id_a: { type: 'string', description: '기준 패키지 (보통 1위)' },
        package_id_b: { type: 'string', description: '비교 대상 (보통 2위)' },
        departure_date: { type: 'string', description: '출발일 YYYY-MM-DD (한 패키지가 여러 출발일 score 가질 수 있음)' },
      },
    },
  },
  {
    name: 'recommend_multi_intent',
    description: '복합 쿼리 처리 — 여러 (날짜+의도) 조합을 한 번에 추천. 예: "5/5 베스트 + 5월말 가성비". 각 항목 별도 정책 ID 자동 매핑. 답변용 마크다운까지 합성.',
    input_schema: {
      type: 'object' as const,
      required: ['queries'],
      properties: {
        queries: {
          type: 'array',
          description: '서로 다른 의도/날짜 쿼리 배열',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '사용자 노출용 (예: "5/5 베스트", "5월말 가성비")' },
              destination: { type: 'string' },
              departure_date: { type: 'string', description: 'YYYY-MM-DD (정확 날짜)' },
              departure_from: { type: 'string', description: '범위 시작 (departure_date 대신)' },
              departure_to: { type: 'string', description: '범위 끝' },
              duration_days: { type: 'number' },
              intent: { type: 'string', description: 'family/couple/filial/budget/no-option' },
              limit: { type: 'number', description: '기본 3' },
            },
            required: ['label', 'destination'],
          },
        },
      },
    },
  },
  {
    name: 'update_package_status',
    description: '패키지 상태를 변경합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['package_id', 'status'],
      properties: {
        package_id: { type: 'string' },
        status: { type: 'string', description: 'DRAFT/REVIEW_NEEDED/APPROVED/ACTIVE' }
      }
    }
  },
  {
    name: 'list_attractions',
    description: '관광지 DB를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: '국가' },
        city: { type: 'string', description: '도시' },
        category: { type: 'string', description: '카테고리 (관광/맛집/쇼핑/액티비티)' },
        query: { type: 'string', description: '검색어' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'search_land_operators',
    description: '랜드사를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'propose_product_registration',
    description: '신규 상품 등록을 기안합니다. (승인 필요) agent_actions 에 기록 → 관리자가 /register 파이프라인으로 승격.',
    input_schema: {
      type: 'object' as const,
      required: ['title', 'destination', 'duration_days'],
      properties: {
        title: { type: 'string', description: '상품명 초안' },
        destination: { type: 'string', description: '목적지' },
        duration_days: { type: 'number', description: '일정 (박:일 중 일)' },
        land_operator_id: { type: 'string', description: '랜드사 ID (있으면)' },
        cost_price: { type: 'number', description: '원가 (원, KRW)' },
        departure_date: { type: 'string', description: '출발일 YYYY-MM-DD' },
        source_url: { type: 'string', description: '원문 URL (랜드사 블로그 등)' },
        raw_notes: { type: 'string', description: '자유 메모 — LLM 이 파악한 원문 요약' },
      },
    },
  },
]

const PRODUCTS_TOOLS = PRODUCTS_TOOLS_RAW

async function executeTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'search_packages': {
      let query = supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, base_price, departure_date, duration_days, status, created_at')
        .order('created_at', { ascending: false })
        .limit(args.limit || 10)
      if (args.destination) query = query.ilike('destination', `%${args.destination}%`)
      if (args.departure_from) query = query.gte('departure_date', args.departure_from)
      if (args.departure_to) query = query.lte('departure_date', args.departure_to)
      if (args.min_price) query = query.gte('base_price', args.min_price)
      if (args.max_price) query = query.lte('base_price', args.max_price)
      if (args.status) query = query.eq('status', args.status)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'get_package_detail': {
      const { data, error } = await supabaseAdmin
        .from('travel_packages')
        .select('*')
        .eq('id', args.package_id)
        .limit(1)
      if (error) throw error
      return data?.[0] || null
    }
    case 'get_package_hotel_mrt_cache': {
      const pid = args.package_id as string
      if (!pid) throw new Error('package_id 필수')
      const { fetchHotelIntelForJarvis } = await import('@/lib/mrt-hotel-intel')
      const dep = typeof args.departure_date === 'string' ? args.departure_date : null
      const rows = await fetchHotelIntelForJarvis(pid, dep)
      return {
        package_id: pid,
        departure_date: dep,
        hotels: rows.map((row: Record<string, unknown>) => {
          const snap = row.mrt_snapshot as Record<string, unknown> | null | undefined
          const dj = snap?.detail_jsonb as Record<string, unknown> | undefined
          return {
            day_index: row.day_index,
            itinerary_hotel_name: row.itinerary_hotel_name,
            itinerary_hotel_grade: row.itinerary_hotel_grade,
            matched_mrt_name: row.matched_mrt_name,
            match_score: row.match_score,
            composite_mrt_score: row.composite_mrt_score,
            market_median_price_krw: row.market_median_price_krw,
            listing_price_krw: row.listing_price_krw,
            price_percentile: row.price_percentile,
            computed_at: row.computed_at,
            amenities: snap?.amenities ?? [],
            check_in: snap?.check_in,
            check_out: snap?.check_out,
            rating: snap?.rating,
            review_count: snap?.review_count,
            provider_url: snap?.provider_url,
            description_excerpt: typeof dj?.description === 'string'
              ? (dj.description as string).slice(0, 800)
              : undefined,
            cancellation_excerpt: typeof dj?.cancellationPolicy === 'string'
              ? (dj.cancellationPolicy as string).slice(0, 600)
              : undefined,
            check_in_time: dj?.checkInTime,
            check_out_time: dj?.checkOutTime,
          }
        }),
      }
    }
    case 'recommend_package': {
      let query = supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, base_price, departure_date, duration_days, highlights, status')
        .in('status', ['approved', 'active'])
        .order('created_at', { ascending: false })
        .limit(3)
      if (args.destination) query = query.ilike('destination', `%${args.destination}%`)
      if (args.budget_per_person) query = query.lte('base_price', args.budget_per_person)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'recommend_best_packages': {
      if (!args.destination) throw new Error('destination 필수')
      const result = await recommendBestPackages({
        destination: args.destination,
        departure_date: args.departure_date ?? null,
        departure_window_days: args.departure_window_days,
        duration_days: args.duration_days ?? null,
        limit: args.limit ?? 3,
      })
      // recommendation_outcomes 노출 누적 (LTR ground truth 자동 시작)
      try {
        const rows = result.ranked.map(r => ({
          package_id: r.package_id,
          source: 'jarvis' as const,
          recommended_rank: r.rank,
          intent: typeof args.intent === 'string' ? args.intent : null,
          policy_id: typeof args.policy_id === 'string' ? args.policy_id : null,
          session_id: typeof args.session_id === 'string' ? args.session_id : null,
          outcome: null,
        }))
        if (rows.length > 0) {
          await supabaseAdmin.from('recommendation_outcomes').insert(rows)
        }
      } catch (e) {
        // 트래킹 실패는 추천 결과 반환을 막지 않음
        console.warn('[jarvis recommend tracking]', e instanceof Error ? e.message : 'failed')
      }
      // 자비스 답변용으로 점수 숫자는 숨기고 사유만 노출
      return {
        group_key: result.group_key,
        group_size: result.group_size,
        ranked: result.ranked.map(r => ({
          package_id: r.package_id,
          title: r.title,
          destination: r.destination,
          departure_date: r.departure_date,
          duration_days: r.duration_days,
          list_price: r.list_price,
          rank: r.rank,
          why: r.breakdown.why,
          features: {
            shopping_count: r.features.shopping_count,
            hotel_avg_grade: r.features.hotel_avg_grade,
            mrt_hotel_quality_score: r.features.mrt_hotel_quality_score ?? null,
            meal_count: r.features.meal_count,
            free_option_count: r.features.free_option_count,
            is_direct_flight: r.features.is_direct_flight,
          },
        })),
      }
    }
    case 'get_scoring_policy': {
      const policy = await getActivePolicy()
      return {
        version: policy.version,
        weights: policy.weights,
        hotel_premium: policy.hotel_premium,
        flight_premium: policy.flight_premium,
        hedonic_coefs: policy.hedonic_coefs,
        notes: policy.notes,
      }
    }
    case 'activate_policy': {
      const policyId = args.policy_id as string;
      if (!policyId) throw new Error('policy_id 필수');
      const { data: target } = await supabaseAdmin.from('scoring_policies')
        .select('id, version').eq('id', policyId).limit(1);
      if (!target || target.length === 0) throw new Error('정책 없음');
      // 기존 active 비활성
      await supabaseAdmin.from('scoring_policies').update({ is_active: false }).eq('is_active', true);
      // 새 active
      const { error } = await supabaseAdmin.from('scoring_policies')
        .update({ is_active: true, updated_at: new Date().toISOString() }).eq('id', policyId);
      if (error) throw error;
      // 알림 (general)
      const { postAlert } = await import('@/lib/admin-alerts');
      await postAlert({
        category: 'general', severity: 'info',
        title: `정책 활성 전환: ${target[0].version}`,
        message: `자비스가 활성 정책을 ${target[0].version} 으로 변경했습니다.${args.reason ? ` 사유: ${args.reason}` : ''} 다음 recompute부터 적용.`,
        ref_type: 'policy', ref_id: policyId,
      });
      return { ok: true, activated_version: target[0].version };
    }
    case 'ack_alert': {
      const { ackAlert } = await import('@/lib/admin-alerts');
      let id: number | null = null;
      if (typeof args.alert_id === 'number') {
        id = args.alert_id;
      } else if (args.category || args.ref_id) {
        // ref 매칭으로 가장 최근 미해결 1건
        let q = supabaseAdmin.from('admin_alerts').select('id').is('acknowledged_at', null).order('created_at', { ascending: false }).limit(1);
        if (typeof args.category === 'string') q = q.eq('category', args.category);
        if (typeof args.ref_type === 'string') q = q.eq('ref_type', args.ref_type);
        if (typeof args.ref_id === 'string') q = q.eq('ref_id', args.ref_id);
        const { data } = await q;
        if (data && data.length > 0) id = data[0].id;
      }
      if (!id) return { error: '확인할 알림 없음 (alert_id 또는 ref 명시 필요)' };
      await ackAlert(id);
      return { ok: true, ack_id: id };
    }
    case 'top_recommended_packages': {
      const { getTopRecommendedPackages } = await import('@/lib/scoring/top-recommended');
      const result = await getTopRecommendedPackages({
        limit: typeof args.limit === 'number' ? args.limit : 20,
        destination: typeof args.destination === 'string' ? args.destination : undefined,
        departureFrom: typeof args.departure_from === 'string' ? args.departure_from : undefined,
        departureTo: typeof args.departure_to === 'string' ? args.departure_to : undefined,
        maxRank: typeof args.max_rank === 'number' ? args.max_rank : 1,
      });
      return { count: result.length, packages: result };
    }
    case 'list_admin_alerts': {
      let q = supabaseAdmin.from('admin_alerts')
        .select('id, created_at, category, severity, title, message, ref_type, ref_id, meta')
        .is('acknowledged_at', null)
        .order('created_at', { ascending: false })
        .limit(typeof args.limit === 'number' ? args.limit : 10);
      if (typeof args.category === 'string') q = q.eq('category', args.category);
      const { data, error } = await q;
      if (error) throw error;
      return { alerts: data ?? [] };
    }
    case 'recommend_compare_pair': {
      const aId = args.package_id_a as string;
      const bId = args.package_id_b as string;
      if (!aId || !bId) throw new Error('package_id_a, package_id_b 필수');
      const date = args.departure_date as string | undefined;
      let q = supabaseAdmin
        .from('package_scores')
        .select('package_id, departure_date, list_price, effective_price, rank_in_group, group_size, shopping_count, hotel_avg_grade, meal_count, free_option_count, is_direct_flight, breakdown, travel_packages!inner(title, product_highlights)')
        .in('package_id', [aId, bId]);
      if (date) q = q.eq('departure_date', date);
      const { data, error } = await q.limit(10);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{
        package_id: string; departure_date: string;
        list_price: number; effective_price: number; rank_in_group: number;
        shopping_count: number; hotel_avg_grade: number | null; meal_count: number;
        free_option_count: number; is_direct_flight: boolean;
        breakdown: { why?: string[]; deductions?: Record<string, number> };
        travel_packages: { title: string; product_highlights: string[] | null } | { title: string; product_highlights: string[] | null }[];
      }>;
      const a = rows.find(r => r.package_id === aId);
      const b = rows.find(r => r.package_id === bId);
      if (!a || !b) return { error: '같은 출발일에 양쪽 패키지가 없어요' };
      const titleOf = (r: typeof a) => Array.isArray(r.travel_packages) ? r.travel_packages[0]?.title : r.travel_packages?.title;
      const highlightsOf = (r: typeof a) => {
        const t = Array.isArray(r.travel_packages) ? r.travel_packages[0] : r.travel_packages;
        return t?.product_highlights ?? [];
      };
      const { comparePackages } = await import('@/lib/scoring/pairwise-diff');
      const diff = comparePackages(
        {
          features: {
            package_id: a.package_id, destination: '', departure_date: a.departure_date,
            duration_days: 0, list_price: a.list_price,
            shopping_count: a.shopping_count, hotel_avg_grade: a.hotel_avg_grade,
            meal_count: a.meal_count, free_option_count: a.free_option_count,
            is_direct_flight: a.is_direct_flight, land_operator_id: null, reliability_score: 0.7, days_since_created: null,
            confirmation_rate: 0, free_time_ratio: 0, korean_meal_count: 0, special_meal_count: 0,
            hotel_location: null, flight_time: null, climate_score: 50, popularity_score: 50, itinerary: null,
          },
          effective_price: a.effective_price,
          product_highlights: highlightsOf(a),
        },
        {
          features: {
            package_id: b.package_id, destination: '', departure_date: b.departure_date,
            duration_days: 0, list_price: b.list_price,
            shopping_count: b.shopping_count, hotel_avg_grade: b.hotel_avg_grade,
            meal_count: b.meal_count, free_option_count: b.free_option_count,
            is_direct_flight: b.is_direct_flight, land_operator_id: null, reliability_score: 0.7, days_since_created: null,
            confirmation_rate: 0, free_time_ratio: 0, korean_meal_count: 0, special_meal_count: 0,
            hotel_location: null, flight_time: null, climate_score: 50, popularity_score: 50, itinerary: null,
          },
          effective_price: b.effective_price,
          product_highlights: highlightsOf(b),
        }
      );
      return {
        a: { package_id: aId, title: titleOf(a), list_price: a.list_price, rank: a.rank_in_group },
        b: { package_id: bId, title: titleOf(b), list_price: b.list_price, rank: b.rank_in_group },
        summary: diff.summary,
        better_axis: diff.better_axis,
        worse_axis: diff.worse_axis,
        price_delta: diff.price_delta,
      };
    }
    case 'recommend_multi_intent': {
      const queries = Array.isArray(args.queries) ? args.queries : []
      if (queries.length === 0) throw new Error('queries 배열 필요')
      const { runMultiIntent, formatMultiIntentAnswer } = await import('@/lib/scoring/multi-intent')
      const sections = await runMultiIntent(queries as Parameters<typeof runMultiIntent>[0])
      // outcomes 자동 누적
      try {
        const rows: Array<Record<string, unknown>> = []
        for (const s of sections) {
          for (const r of s.ranked) {
            rows.push({
              package_id: r.package_id,
              source: 'jarvis',
              recommended_rank: r.rank,
              intent: s.intent_used,
              session_id: typeof args.session_id === 'string' ? args.session_id : null,
              outcome: null,
              notes: s.label,
            })
          }
        }
        if (rows.length > 0) await supabaseAdmin.from('recommendation_outcomes').insert(rows)
      } catch (e) {
        console.warn('[multi-intent tracking]', e instanceof Error ? e.message : 'failed')
      }
      return {
        sections: sections.map(s => ({
          label: s.label,
          group_size: s.group_size,
          intent_used: s.intent_used,
          ranked: s.ranked.map(r => ({
            package_id: r.package_id, title: r.title, list_price: r.list_price,
            rank: r.rank, why: r.breakdown.why,
          })),
        })),
        formatted_answer: formatMultiIntentAnswer(sections),
      }
    }
    case 'list_attractions': {
      let query = supabaseAdmin
        .from('attractions')
        .select('id, name, country, city, category, short_desc, rating')
        .order('rating', { ascending: false })
        .limit(args.limit || 10)
      if (args.country) query = query.ilike('country', `%${args.country}%`)
      if (args.city) query = query.ilike('city', `%${args.city}%`)
      if (args.category) query = query.eq('category', args.category)
      if (args.query) query = query.ilike('name', `%${args.query}%`)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'search_land_operators': {
      let query = supabaseAdmin
        .from('land_operators')
        .select('id, name, country, contact_name, contact_phone, rating, is_active')
        .eq('is_active', true)
        .limit(args.limit || 10)
      if (args.country) query = query.ilike('country', `%${args.country}%`)
      if (args.query) query = query.ilike('name', `%${args.query}%`)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'propose_product_registration': {
      if (!args.title || !args.destination) throw new Error('title, destination 필수')
      const summary = `[상품 등록 기안] ${args.destination} · ${args.title} (${args.duration_days}일)`
      const { data, error } = await supabaseAdmin
        .from('agent_actions')
        .insert({
          agent_type: 'products',
          action_type: 'register_product',
          summary,
          payload: {
            title: args.title,
            destination: args.destination,
            duration_days: args.duration_days,
            land_operator_id: args.land_operator_id ?? null,
            cost_price: args.cost_price ?? null,
            departure_date: args.departure_date ?? null,
            source_url: args.source_url ?? null,
            raw_notes: args.raw_notes ?? null,
          },
          requested_by: 'jarvis',
          priority: 'normal',
        })
        .select()
      if (error) throw error
      return {
        proposed: true,
        action_id: data?.[0]?.id,
        summary,
        next_step: '관리자가 /register 또는 /register-via-ir 로 실제 등록 수행',
      }
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

// V2 (gemini-agent-loop-v2.ts) 공유 export
export { PRODUCTS_TOOLS, PRODUCTS_TOOLS_RAW }
export { executeTool as executeProductsTool }

export async function runProductsAgent(params: AgentRunParams): Promise<AgentRunResult> {
  return runDeepSeekAgentLoop({
    agentType: 'products',
    systemPrompt: PRODUCTS_PROMPT,
    tools: PRODUCTS_TOOLS,
    executeTool,
  }, params)
}
