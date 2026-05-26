/**
 * Threads Auto Publisher — 15~30분마다 실행
 *
 * 역할:
 *   1. content_distributions에서 status='ready'인 미발행 Threads 포스트 조회
 *   2. quota 체크 (checkThreadsPublishingLimit — 250/24h)
 *   3. 자연스러운 발행 간격 유지 (최소 1시간, 하루 최대 5개)
 *   4. publishToThreads() 호출 → 결과 기록
 *   5. 성공 → content_distributions.status='published'
 *   6. 실패 → 재시도 1회 후 status='failed'
 *
 * 안전장치:
 *   - 하루 최대 발행 수 = 5개 (quota 250의 2%)
 *   - 발행 간격 최소 1시간
 *   - quota 80% 이상이면 발행 중단
 *   - 연속 실패 3회 → 크론 일시 중단 (Slack 알림)
 *   - engagement-bait 검증 (validateThreadsBody)
 *
 * 참고:
 *   - Meta 공식 Threads API: 250 posts / 24h
 *   - 우리는 하루 5개 = 안전 마진 50배
 *   - 차단 위험: 포스트 발행만 자동화하면 거의 없음 (문제는 자동댓글/좋아요)
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import {
  publishToThreads,
  getThreadsConfig,
  checkThreadsPublishingLimit,
  validateThreadsBody,
  replyToThread,
} from '@/lib/threads-publisher';
import { measureDeviation, selectFingerprint } from '@/lib/trend-style-engine';
import { notifySlack } from '@/lib/slack-notifier';
import { extractThreadsFeatures, runCriticGate } from '@/lib/content-pipeline/critic';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2분
export const dynamic = 'force-dynamic';

/** 하루 최대 발행 수 (안전장치) */
const MAX_DAILY_POSTS = 5;
/** 발행 간격 최소 시간 */
const MIN_INTERVAL_HOURS = 1;
/** Quota 80% 이상이면 중단 */
const QUOTA_THRESHOLD = 0.8;
/** 연속 실패 임계 */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Buffer 2.5M Posts 분석 기반 최적 발행 시간 (KST)
 *   - 가장 좋은 시간: 목 09:00, 수 12:00, 수 09:00
 *   - 최적 윈도우: 평일 06:00~11:00
 *   - 최악: 주말 저녁
 *
 * 현재 시간이 최적 시간대인지 확인.
 * 평일 06:00~11:00 사이면 최적, 그 외이면 플래너가 덜 최적 시간으로 간주
 */
function isOptimalPostingTime(date: Date): boolean {
  const hour = date.getHours();
  const day = date.getDay(); // 0=Sun, 6=Sat
  // 주말은 발행하지 않음 (최악 시간대)
  if (day === 0 || day === 6) return false;
  // 평일 06:00~11:00 = 최적
  return hour >= 6 && hour <= 11;
}

/**
 * 현재 시간에서 가장 가까운 최적 발행 시간까지의 대기 시간(ms) 계산
 * 발행 간격 (1시간)을 만족하면서 다음 최적 시간 리턴
 */
function msUntilNextOptimalTime(date: Date): number {
  const now = date.getTime();
  // 1시간 이상 간격을 보장
  const oneHourMs = 60 * 60 * 1000;
  const dayCycleMs = 24 * 60 * 60 * 1000;

  // 오늘~내일 사이 모든 최적 시간대 확인
  for (let offset = oneHourMs; offset <= dayCycleMs; offset += oneHourMs) {
    const candidate = new Date(now + offset);
    if (isOptimalPostingTime(candidate)) {
      return offset;
    }
  }
  // 없으면 최소 1시간
  return oneHourMs;
}

interface DistributionRow {
  id: string;
  payload: Record<string, unknown>;
  generation_config: Record<string, unknown> | null;
}

async function runPublisher(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정' };
  }

  const errors: string[] = [];

  // ── 1. Threads 설정 확인 ────────────────────────────────────
  const config = await getThreadsConfig();
  if (!config) {
    return { skipped: true, reason: 'Threads access token 미설정' };
  }

  // ── 2. 오늘 이미 발행한 수 확인 ───────────────────────────
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: todayPosts, error: countErr } = await supabaseAdmin
    .from('content_distributions')
    .select('id')
    .eq('platform', 'threads_post')
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .gte('published_at', todayStart.toISOString());

  if (countErr) {
    errors.push(`오늘 발행 수 조회 실패: ${countErr.message}`);
  }

  const todayCount = (todayPosts ?? []).length;
  if (todayCount >= MAX_DAILY_POSTS) {
    return {
      skipped: true,
      reason: `하루 최대치 도달 (${todayCount}/${MAX_DAILY_POSTS})`,
      today_published: todayCount,
    };
  }

  // ── 3. Quota 체크 ──────────────────────────────────────────
  const quota = await checkThreadsPublishingLimit(config.threadsUserId, config.accessToken);
  if (quota) {
    const usageRatio = quota.quotaUsed / Math.max(quota.quotaLimit, 1);
    if (usageRatio >= QUOTA_THRESHOLD) {
      return {
        skipped: true,
        reason: `Quota ${Math.round(usageRatio * 100)}% 도달 (한도: ${QUOTA_THRESHOLD * 100}%)`,
        quota_used: quota.quotaUsed,
        quota_limit: quota.quotaLimit,
      };
    }
  }

  // ── 4. 가장 최근 발행 시각 확인 (간격 유지) ────────────────
  const { data: lastPublished } = await supabaseAdmin
    .from('content_distributions')
    .select('published_at')
    .eq('platform', 'threads_post')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1);

  if (lastPublished && lastPublished.length > 0) {
    const lastTime = new Date(lastPublished[0].published_at as string);
    const hoursSinceLast = (Date.now() - lastTime.getTime()) / (1000 * 60 * 60);
    const neededMs = msUntilNextOptimalTime(new Date());
    const waitHoursSinceLast = neededMs / (1000 * 60 * 60);
    if (hoursSinceLast < waitHoursSinceLast) {
      return {
        skipped: true,
        reason: `최적 발행 시간까지 ${waitHoursSinceLast.toFixed(1)}시간 필요 (현재 ${hoursSinceLast.toFixed(1)}시간 경과)`,
        last_published_at: lastPublished[0].published_at,
        next_optimal_in: `${Math.round(neededMs / 60000)}분`,
      };
    }
  }

  // ── 5. 발행할 포스트 조회 (status = ready, 오래된 순) ──────
  const remaining = MAX_DAILY_POSTS - todayCount;

  const { data: distributions, error: distErr } = await supabaseAdmin
    .from('content_distributions')
    .select('id, payload, generation_config')
    .eq('platform', 'threads_post')
    .eq('status', 'ready')
    .order('created_at', { ascending: true })
    .limit(remaining * 2); // 여유있게 가져와서 lock 실패분 대비

  if (distErr) {
    errors.push(`발행 대기 포스트 조회 실패: ${distErr.message}`);
  }

  const readyPosts = (distributions ?? []) as unknown as DistributionRow[];
  if (readyPosts.length === 0) {
    return { skipped: true, reason: '발행할 포스트 없음' };
  }

  // ── 6. 한 개씩 발행 ────────────────────────────────────────
  const results: Array<{
    distribution_id: string;
    ok: boolean;
    post_id?: string;
    error?: string;
  }> = [];

  // 연속 실패 카운터 (세션 변수 — 메모리 기반)
  let consecutiveFailures = 0;

  for (const dist of readyPosts) {
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      errors.push(`연속 ${MAX_CONSECUTIVE_FAILURES}회 실패 → 발행 중단`);
      break;
    }

    // ── Atomic Lock: status = 'ready'인 것만 'publishing'으로 변경 ──
    // 동시에 실행된 다른 크론 인스턴스가 같은 row를 이미 가져갔으면 skip
    const { data: locked, error: lockErr } = await supabaseAdmin
      .from('content_distributions')
      .update({ status: 'publishing' })
      .eq('id', dist.id)
      .eq('status', 'ready')
      .select('id')
      .single();

    if (lockErr || !locked) {
      // 다른 인스턴스가 이미 선점 → skip (에러 아님)
      results.push({ distribution_id: dist.id, ok: false, error: '다른 인스턴스가 선점' });
      continue;
    }

      const payload = dist.payload as Record<string, unknown> | undefined;
    const mainText = String(payload?.main ?? '');
    const mediaUrl = String(payload?.media_url ?? '');
    const topicTags = Array.isArray(payload?.topic_tags) ? payload.topic_tags as string[] : [];

    // destination 추출 (자체 댓글에 사용)
    const destName = ((payload?.product as Record<string, unknown> | undefined)?.destination as string) ?? '여행';

    if (!mainText || mainText.length < 20) {
      // 본문 없음 → failed
      await supabaseAdmin.from('content_distributions')
        .update({ status: 'failed' })
        .eq('id', dist.id);

      results.push({ distribution_id: dist.id, ok: false, error: '본문 부족' });
      consecutiveFailures++;
      continue;
    }

    // thread 합치기 (main + thread[])
    const threadParts = Array.isArray(payload?.thread)
      ? (payload.thread as string[]).join('\n\n')
      : '';
    const fullText = threadParts
      ? `${mainText}\n\n${threadParts}`
      : mainText;

    // ── Deviation Check (문체 일치도 검증) ─────────────────
    // 생성 시 사용한 fingerprint가 있으면 측정, 없으면 기본 threads-default 사용
    const genConfig = dist.generation_config as Record<string, unknown> | undefined;
    const category = (genConfig?.category as string | undefined);
    const angleType = (genConfig?.angleType as string | undefined);
    const trendKeyword = (genConfig?.trendKeyword as string | undefined);
    const fingerprint = selectFingerprint(
      'threads',
      trendKeyword ? [trendKeyword] : [],
      angleType,
    );
    const deviation = measureDeviation(fullText, fingerprint);
    if (!deviation.passed) {
      // deviation 초과 → failed 처리 (저품질 콘텐츠 발행 방지)
      await supabaseAdmin
        .from('content_distributions')
        .update({
          status: 'failed',
          generation_config: {
            ...(genConfig ?? {}),
            deviationReport: deviation,
            failedBy: 'auto-publisher-deviation-gate',
          },
        })
        .eq('id', dist.id);

      results.push({
        distribution_id: dist.id,
        ok: false,
        error: `문체 편차 ${deviation.overall_deviation.toFixed(2)} (허용: ${fingerprint.controls.max_deviation}) — ${deviation.failures.join('; ')}`,
      });
      consecutiveFailures++;
      continue;
    }

    // ── Engagement-bait / 콘텐츠 정책 검증 ─────────────
    const validationError = validateThreadsBody(fullText);
    if (validationError) {
      await supabaseAdmin
        .from('content_distributions')
        .update({
          status: 'failed',
          generation_config: {
            ...(genConfig ?? {}),
            validationError,
            failedBy: 'auto-publisher-validation-gate',
          },
        })
        .eq('id', dist.id);

      results.push({
        distribution_id: dist.id,
        ok: false,
        error: `콘텐츠 정책 위반: ${validationError}`,
      });
      consecutiveFailures++;
      continue;
    }

    // ── Critic Gate (ER 예측 + 룰 기반 발행 결정) ──────
    const criticFeatures = extractThreadsFeatures({
      text: fullText,
      hook_type: genConfig?.category as string ?? null,
      posting_hour_kst: new Date().getHours(),
    });
    const criticDecision = await runCriticGate({
      platform: 'threads',
      features: criticFeatures,
      fullText,
      brandId: 'yeosonam',
    });
    if (!criticDecision.approved) {
      await supabaseAdmin
        .from('content_distributions')
        .update({
          status: 'failed',
          generation_config: {
            ...(genConfig ?? {}),
            criticRejection: criticDecision.rejected_reason,
            criticReason: criticDecision.reason,
            failedBy: 'auto-publisher-critic-gate',
          },
        })
        .eq('id', dist.id);

      results.push({
        distribution_id: dist.id,
        ok: false,
        error: `Critic 거부: ${criticDecision.reason ?? criticDecision.rejected_reason}`,
      });
      consecutiveFailures++;
      continue;
    }

    try {
      const hashtagText = topicTags.length > 0
        ? '\n\n' + topicTags.join(' ')
        : '';

      const result = await publishToThreads({
        threadsUserId: config.threadsUserId,
        accessToken: config.accessToken,
        text: (fullText + hashtagText).slice(0, 500),
        imageUrls: mediaUrl ? [mediaUrl] : undefined,
      });

      if (result.ok) {
        // 성공
        await supabaseAdmin
          .from('content_distributions')
          .update({
            status: 'published',
            published_at: new Date().toISOString(),
            external_id: result.postId,
            generation_config: {
              ...(dist.generation_config as Record<string, unknown> ?? {}),
              publishedBy: 'auto-publisher',
            },
          })
          .eq('id', dist.id);

        // ── engagement velocity: 90초 내 자체 댓글 추가 ─────
        if (result.postId) {
          const selfReply = `혹시 ${destName} 궁금한 점 있으시면 편하게 물어봐주세요!`;
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 딜레이 (Threads API 안정성)
          replyToThread({
            threadsUserId: config.threadsUserId,
            accessToken: config.accessToken,
            postId: result.postId,
            text: selfReply,
          }).catch(() => {}); // 댓글 실패는 무시 (주요 흐름 차단 방지)
        }

        results.push({
          distribution_id: dist.id,
          ok: true,
          post_id: result.postId,
        });
        consecutiveFailures = 0; // 성공 시 리셋
      } else {
        // 실패
        await supabaseAdmin
          .from('content_distributions')
          .update({
            status: 'failed',
            generation_config: {
              ...(dist.generation_config as Record<string, unknown> ?? {}),
              publishError: result.error,
            },
          })
          .eq('id', dist.id);

        results.push({
          distribution_id: dist.id,
          ok: false,
          error: result.error ?? '발행 실패',
        });
        consecutiveFailures++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabaseAdmin
        .from('content_distributions')
        .update({ status: 'failed' })
        .eq('id', dist.id);

      results.push({ distribution_id: dist.id, ok: false, error: msg });
      consecutiveFailures++;
    }

    // 발행 간 natural delay
    if (readyPosts.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // ── 연속 실패 시 Slack 알림 ────────────────────────────────
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    await notifySlack('critical', {
      title: '⚠️ Threads Auto-Publisher 연속 실패',
      message: `연속 ${consecutiveFailures}회 실패로 발행이 중단되었습니다.\n마지막 에러: ${errors[errors.length - 1] ?? '알 수 없음'}`,
      fields: [
        { label: '시도', value: String(results.length) },
        { label: '성공', value: String(results.filter(r => r.ok).length) },
        { label: '실패', value: String(results.filter(r => !r.ok).length) },
        { label: '크론', value: 'threads-auto-publisher' },
      ],
    }).catch(() => {}); // Slack 실패는 무시 (주요 흐름 차단 방지)
  }

  return {
    attempted: results.length,
    success: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    today_total: todayCount + results.filter(r => r.ok).length,
    quota: quota ?? { quotaUsed: 0, quotaLimit: 250 },
    results: results.map(r => ({
      id: r.distribution_id.slice(0, 8),
      ok: r.ok,
      post_id: r.post_id,
      error: r.error,
    })),
    errors: errors.length > 0 ? errors : undefined,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('threads-auto-publisher', runPublisher);
