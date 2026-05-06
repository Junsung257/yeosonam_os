/**
 * Phase 3-E: 리뷰 감정 분석 크론
 * GET /api/cron/review-sentiment
 *
 * - sentiment_analyzed_at IS NULL 리뷰 최대 20개 가져와서 Gemini Flash로 분석
 * - { sentiment_score: 0-100, tags: { 숙소, 가이드, 일정, 식사 } } 추출
 * - 결과를 DB에 업데이트
 *
 * Vercel Cron: 0 * * * * (매시간)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sendSlackAlert } from '@/lib/slack-alert';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface SentimentResult {
  sentiment_score: number;
  tags: {
    숙소?: number;
    가이드?: number;
    일정?: number;
    식사?: number;
    [key: string]: number | undefined;
  };
}

async function analyzeReviewSentiment(content: string, rating: number): Promise<SentimentResult | null> {
  const apiKey = getSecret('GEMINI_API_KEY');
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `다음 여행 패키지 리뷰를 분석하여 JSON으로 응답하세요.

별점: ${rating}/5
리뷰 내용: ${content || '(내용 없음)'}

다음 형식의 JSON만 반환하세요 (설명 없이):
{
  "sentiment_score": 0-100 사이의 정수 (0=매우 부정, 100=매우 긍정),
  "tags": {
    "숙소": 0-100,
    "가이드": 0-100,
    "일정": 0-100,
    "식사": 0-100
  }
}

리뷰 내용에서 해당 카테고리 언급이 없으면 별점 기반으로 기본값 추정.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // JSON 추출 (코드블록 제거)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as SentimentResult;

    // 유효성 검사
    if (typeof parsed.sentiment_score !== 'number') return null;
    parsed.sentiment_score = Math.max(0, Math.min(100, Math.round(parsed.sentiment_score)));

    const tags = parsed.tags ?? {};
    for (const key of ['숙소', '가이드', '일정', '식사']) {
      if (typeof tags[key] === 'number') {
        tags[key] = Math.max(0, Math.min(100, Math.round(tags[key] as number)));
      } else {
        // 별점 기반 기본값
        tags[key] = Math.round(rating * 20);
      }
    }
    parsed.tags = tags;

    return parsed;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const apiKey = getSecret('GEMINI_API_KEY');
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'GEMINI_API_KEY 미설정', analyzed: 0 });
  }

  try {
    // 아직 분석하지 않은 리뷰 최대 20개 조회
    const { data: reviews, error: fetchErr } = await supabaseAdmin
      .from('package_reviews')
      .select('id, rating, content')
      .is('sentiment_analyzed_at', null)
      .limit(20);

    if (fetchErr) throw fetchErr;
    if (!reviews || reviews.length === 0) {
      return NextResponse.json({ ok: true, analyzed: 0, message: '분석 대기 리뷰 없음' });
    }

    let analyzed = 0;
    let failed = 0;

    for (const review of reviews) {
      const result = await analyzeReviewSentiment(
        review.content ?? '',
        review.rating as number,
      );

      if (result) {
        const { error: updateErr } = await supabaseAdmin
          .from('package_reviews')
          .update({
            sentiment_score: result.sentiment_score,
            sentiment_tags: result.tags,
            sentiment_analyzed_at: new Date().toISOString(),
          })
          .eq('id', review.id);

        if (updateErr) {
          failed++;
          console.error(`[review-sentiment] 업데이트 실패 ${review.id}:`, updateErr.message);
        } else {
          analyzed++;
        }
      } else {
        failed++;
      }

      // Gemini Rate Limit 방어 (분당 60 RPM 기본)
      await new Promise(r => setTimeout(r, 300));
    }

    if (failed > 0) {
      await sendSlackAlert(`[리뷰 감정분석] ${analyzed}건 완료, ${failed}건 실패`, {
        total: reviews.length,
        analyzed,
        failed,
      });
    }

    return NextResponse.json({ ok: true, analyzed, failed, total: reviews.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 실패';
    await sendSlackAlert('[리뷰 감정분석 크론] 오류', { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
