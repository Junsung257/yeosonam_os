import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { llmCall } from '@/lib/llm-gateway';

/**
 * Review Digest — 매일 1회 실행
 *
 * 흐름:
 *   1) 활성/승인 패키지 중 approved review ≥3개 보유 + 최근 30일 내 신규 리뷰가 있는 패키지 선별
 *   2) approved 리뷰 6~10건을 LLM(summary task)로 1줄 요약 3종 생성
 *   3) package_review_digests 에 upsert (모바일 hero 직하 carousel 노출용)
 *
 * Why:
 *   "검색→클릭→신뢰 가속" 루프. AI 리뷰 요약 hero 노출은 전환율 직결.
 *   배치 1회로 여러 패키지 갱신 → 페이지 부담 0, LLM 비용 통제.
 *
 * 모델: DeepSeek Flash (summary task) — 1줄 요약은 저비용 모델로 충분.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const PER_RUN_PACKAGE_LIMIT = 30;       // 1회 실행당 최대 패키지 수 (비용 통제)
const MIN_REVIEWS_FOR_DIGEST = 3;        // 요약할 가치가 있는 최소 리뷰 수
const REVIEW_LOOKBACK_DAYS = 30;         // 리뷰가 최근 30일 내 갱신된 패키지만
const SOURCE_REVIEW_SAMPLE = 8;          // LLM에 넘기는 리뷰 샘플 수

interface DigestQuote {
  text: string;       // 1줄 요약 (≤80자)
  source_count: number;
  rating: number;     // 평균 평점
}

async function summarizeReviews(reviews: Array<{ review_text: string | null; pros: string[] | null; overall_rating: number }>): Promise<DigestQuote[]> {
  if (reviews.length === 0) return [];

  const sample = reviews
    .map(r => {
      const t = (r.review_text || '').trim();
      const pros = (r.pros || []).filter(p => typeof p === 'string').join(', ');
      return `[평점 ${r.overall_rating}/5] ${t}${pros ? ` · 장점: ${pros}` : ''}`;
    })
    .filter(s => s.length > 12)
    .slice(0, SOURCE_REVIEW_SAMPLE)
    .join('\n');

  const systemPrompt = [
    '당신은 여소남(여행 패키지 플랫폼)의 리뷰 요약가입니다.',
    '실제 다녀온 고객 리뷰를 1줄(80자 이내)로 압축한 후기 카드 3개를 만듭니다.',
    '규칙:',
    '- 원문 사실에서 벗어나지 않는다 (없는 호텔·없는 일정 추가 금지)',
    '- "최고", "완벽한" 같은 클리셰 형용사 금지',
    '- 구체적 디테일 1개 이상 포함 (장소/시간/메뉴/감정 한 단어)',
    '- 평점이 낮은 리뷰의 부정 의견은 발췌하지 않는다',
    '- 출력은 JSON 배열만: [{"text":"...","rating":4.7}]',
  ].join('\n');

  const userPrompt = `다음 ${reviews.length}건 리뷰 중 의미있는 3건을 1줄 요약하세요.\n\n${sample}\n\n→ JSON 배열 (3개)만 출력`;

  try {
    const result = await llmCall<DigestQuote[]>({
      task: 'summary',
      systemPrompt,
      userPrompt,
      maxTokens: 400,
      temperature: 0.4,
      enableCaching: true,
    });
    if (!result.success || !result.rawText) return [];

    const m = result.rawText.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]) as Array<{ text?: string; rating?: number }>;
    return parsed
      .filter(p => typeof p.text === 'string' && p.text.length > 4 && p.text.length <= 100)
      .slice(0, 3)
      .map(p => ({
        text: (p.text as string).trim(),
        source_count: reviews.length,
        rating: typeof p.rating === 'number' ? +p.rating.toFixed(1) : 0,
      }));
  } catch (e) {
    console.warn('[review-digest] summarize 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

async function runReviewDigest(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];
  const since = new Date();
  since.setDate(since.getDate() - REVIEW_LOOKBACK_DAYS);
  const sinceIso = since.toISOString();

  // 1) 후보 패키지 — approved review가 충분히 있고 최근 갱신
  // 한 번에 fetch 후 group by — RPC 없이 처리
  const { data: recentReviews, error: rErr } = await supabaseAdmin
    .from('post_trip_reviews')
    .select('package_id, overall_rating, review_text, pros, helpful_count, created_at')
    .eq('status', 'approved')
    .gte('created_at', sinceIso)
    .order('helpful_count', { ascending: false, nullsFirst: false })
    .limit(500);

  if (rErr) {
    errors.push(`리뷰 fetch 실패: ${rErr.message}`);
    return { processed: 0, updated: 0, errors };
  }

  // 패키지별 집계
  const byPackage = new Map<string, Array<{ review_text: string | null; pros: string[] | null; overall_rating: number; helpful_count: number | null }>>();
  for (const r of (recentReviews || []) as Array<any>) {
    if (!r.package_id) continue;
    if (!byPackage.has(r.package_id)) byPackage.set(r.package_id, []);
    byPackage.get(r.package_id)!.push({
      review_text: r.review_text,
      pros: r.pros,
      overall_rating: r.overall_rating,
      helpful_count: r.helpful_count,
    });
  }

  // 최소 리뷰 수 필터
  const eligiblePackages = Array.from(byPackage.entries())
    .filter(([, reviews]) => reviews.length >= MIN_REVIEWS_FOR_DIGEST)
    .slice(0, PER_RUN_PACKAGE_LIMIT);

  if (eligiblePackages.length === 0) {
    return { processed: 0, updated: 0, errors: ['eligible 패키지 없음'], message: '리뷰 부족' };
  }

  // 2) 패키지 메타 일괄 조회
  const packageIds = eligiblePackages.map(([id]) => id);
  const { data: pkgs } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination')
    .in('id', packageIds);
  const destMap = new Map<string, string | null>();
  for (const p of (pkgs || []) as Array<{ id: string; destination: string | null }>) {
    destMap.set(p.id, p.destination ?? null);
  }

  // 3) 패키지별 요약 + upsert
  let updated = 0;
  for (const [pkgId, reviews] of eligiblePackages) {
    try {
      // 평점 높은 + helpful_count 높은 리뷰 우선
      const sorted = [...reviews].sort((a, b) => {
        if (b.overall_rating !== a.overall_rating) return b.overall_rating - a.overall_rating;
        return (b.helpful_count ?? 0) - (a.helpful_count ?? 0);
      });
      const quotes = await summarizeReviews(sorted);
      if (quotes.length === 0) {
        errors.push(`pkg ${pkgId}: 요약 0건`);
        continue;
      }

      const avgRating = +(reviews.reduce((s, r) => s + r.overall_rating, 0) / reviews.length).toFixed(2);
      const { error: upErr } = await supabaseAdmin
        .from('package_review_digests')
        .upsert({
          package_id: pkgId,
          destination: destMap.get(pkgId) ?? null,
          digest_quotes: quotes,
          source_count: reviews.length,
          avg_rating: avgRating,
          model: 'summary-task-v1',
          generated_at: new Date().toISOString(),
        }, { onConflict: 'package_id' });

      if (upErr) {
        errors.push(`pkg ${pkgId} upsert: ${upErr.message}`);
      } else {
        updated += 1;
      }

      // Rate limit 방어
      await new Promise(r => setTimeout(r, 250));
    } catch (e) {
      errors.push(`pkg ${pkgId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    processed: eligiblePackages.length,
    updated,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('review-digest', runReviewDigest);
