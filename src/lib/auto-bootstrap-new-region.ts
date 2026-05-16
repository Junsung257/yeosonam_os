/**
 * @file auto-bootstrap-new-region.ts
 *
 * 신규 지역 첫 등록 시 자동 부트스트랩 (PR #94, ERR-XIY-2026-05-16).
 *
 * 시즈오카 사고: DB 에 시즈오카 attraction 0건 → 등록 시 미매칭 21건 → 모바일 attraction 카드 0개.
 * 사장님은 paste-and-parse 모달이 별도 메뉴라는 걸 모르고 "안 됨" 판단.
 *
 * 해결: POST /api/upload 직후 백그라운드로 미매칭 활동들 → DeepSeek 카드 분해 → unmatched_activities.suggested_card 적재.
 *      사장님 어드민에서 ☑ 한 번 → 일괄 attractions INSERT → reEnrichAffectedPackages (PR #93) → 모바일 즉시 반영.
 *
 * STRICT SSOT 정책 준수:
 *   - 자동 INSERT 안 함. suggested_card 적재만.
 *   - 사장님 명시 ☑ 후에만 attractions INSERT.
 */

import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { llmCall } from './llm-gateway';
import { postAlert } from './admin-alerts';

const SYS = `당신은 여소남 OS 의 한국 패키지 여행 attraction 카드 분해 도우미입니다.

미매칭 큐의 활동 라인 배열을 받으면, 진짜 관광지(POI)만 골라 카드로 분해합니다.

규칙:
1. 진짜 관광지만 추출. 호텔/식당/투어상품/공항픽업/wifi/eSIM/쇼핑센터/식사/이동/도착 제외.
2. verbatim 서술 라인이면 그 안의 캐노니컬 명사만 추출 (예: "양귀비와 당현종의 로맨스장소인 화청지" → "화청지").
3. short_desc: 30-60자 정보성+호기심+친근 톤. 슬래시 나열 금지. 마침표 1개.
4. long_desc: 2-3문장 100-200자. 친근 한국어. 사실만.
5. badge_type: tour | special | shopping | meal | optional | hotel | restaurant | golf | activity | onsen
6. emoji: 1글자 (📍🏛️⛩️🌊🗼🍜 등)
7. aliases: 한국어/영어/일본어/중국어 다른 표기

응답: JSON 배열만.
[
  {"original_activity": "원본 라인", "name": "캐노니컬 명사", "short_desc": "...", "long_desc": "...", "badge_type": "tour", "emoji": "📍", "aliases": ["..."]},
  ...
]

attraction 아닌 활동은 카드 응답에서 제외 (배열에 안 넣음).`;

interface SuggestedCard {
  original_activity: string;
  name: string;
  short_desc: string;
  long_desc: string;
  badge_type: string;
  emoji: string;
  aliases: string[];
}

/**
 * 백그라운드 부트스트랩.
 * @param packageId 트리거 패키지 ID (suggested_at 업데이트 추적용)
 * @param region 지역 (시즈오카 등)
 * @param country 국가
 * @param activities 미매칭 활동 라인 배열 (최대 30건)
 */
export async function bootstrapNewRegionAsync(args: {
  packageId: string;
  region: string | null;
  country: string | null;
  activities: string[];
}): Promise<{ suggested: number; alerted: boolean }> {
  if (!isSupabaseConfigured) return { suggested: 0, alerted: false };
  const acts = [...new Set(args.activities)].slice(0, 30);
  if (acts.length === 0) return { suggested: 0, alerted: false };

  // 1) 이미 DB 에 같은 지역 attraction 이 충분히 있으면 부트스트랩 불필요
  if (args.region || args.country) {
    const { count } = await supabaseAdmin
      .from('attractions')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .or(args.region ? `region.ilike.%${args.region}%` : 'region.is.null')
      .or(args.country ? `country.eq.${args.country}` : 'country.is.null');
    if ((count ?? 0) >= 10) {
      // 이미 충분 — 부트스트랩 스킵 (alias 자동 학습으로 처리)
      return { suggested: 0, alerted: false };
    }
  }

  // 2) DeepSeek 카드 분해
  const userPrompt = `지역: ${args.region ?? '미지정'} ${args.country ? `(${args.country})` : ''}

미매칭 활동 라인 배열:
${JSON.stringify(acts, null, 2)}

위 라인들에서 진짜 attraction 카드만 추출. JSON 배열만:`;

  let result;
  try {
    result = await llmCall<unknown>({
      task: 'extract-meta',
      systemPrompt: SYS,
      userPrompt,
      maxTokens: 4000,
    });
  } catch (e) {
    console.warn('[bootstrap] LLM 호출 실패:', e instanceof Error ? e.message : e);
    return { suggested: 0, alerted: false };
  }
  if (!result.success) {
    console.warn('[bootstrap] LLM 실패:', result.errors?.join(','));
    return { suggested: 0, alerted: false };
  }

  // 3) 결과 파싱
  let cards: SuggestedCard[] = [];
  const raw = result.data ?? result.rawText;
  try {
    if (Array.isArray(raw)) cards = raw as SuggestedCard[];
    else if (typeof raw === 'string') {
      const trimmed = raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
      cards = JSON.parse(trimmed) as SuggestedCard[];
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      cards = (obj.cards ?? obj.result ?? obj.attractions ?? []) as SuggestedCard[];
    }
  } catch (e) {
    console.warn('[bootstrap] JSON parse 실패:', e instanceof Error ? e.message : e);
    return { suggested: 0, alerted: false };
  }

  const validCards = cards.filter(c =>
    c && typeof c.name === 'string' && c.name.trim().length >= 2
      && typeof c.original_activity === 'string'
  );
  if (validCards.length === 0) return { suggested: 0, alerted: false };

  // 4) unmatched_activities.suggested_card 적재 (original_activity 매칭)
  let suggestedCount = 0;
  for (const card of validCards) {
    const sanitized = {
      name: card.name.trim(),
      short_desc: (card.short_desc ?? '').toString().trim() || null,
      long_desc: (card.long_desc ?? '').toString().trim() || null,
      badge_type: card.badge_type ?? 'tour',
      emoji: (card.emoji ?? '').toString().trim() || '📍',
      aliases: Array.isArray(card.aliases) ? card.aliases.filter((a): a is string => typeof a === 'string' && a.length >= 2) : [],
    };
    const { error, count } = await supabaseAdmin
      .from('unmatched_activities')
      .update({
        suggested_card: sanitized,
        suggested_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('status', 'pending')
      .ilike('activity', `%${card.original_activity.slice(0, 30)}%`);
    if (!error && (count ?? 0) > 0) suggestedCount += (count ?? 0);
  }

  // 5) admin_alerts 발송 (사장님 검토 필요)
  let alerted = false;
  if (suggestedCount > 0) {
    try {
      await postAlert({
        category: 'general',
        severity: 'info',
        title: `🤖 신규 지역 ${args.region ?? '미지정'} — ${suggestedCount}건 AI 추천 카드 준비 완료`,
        message: `등록한 패키지의 미매칭 ${acts.length}건 중 ${suggestedCount}건의 attraction 카드가 자동 분해됐습니다. 어드민에서 ☑ 검토 후 일괄 등록하시면 모바일에 즉시 표시됩니다.`,
        ref_type: 'travel_package',
        ref_id: args.packageId,
        meta: { region: args.region, country: args.country, suggested_count: suggestedCount, total_activities: acts.length },
        dedupe: true,
      });
      alerted = true;
    } catch (e) {
      console.warn('[bootstrap] admin_alert 실패:', e instanceof Error ? e.message : e);
    }
  }

  return { suggested: suggestedCount, alerted };
}
