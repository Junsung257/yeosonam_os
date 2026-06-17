import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { llmCall } from '@/lib/llm-gateway';
import { withCronLogging } from '@/lib/cron-observability';
import { normalizeBlogTopicQueueRow } from '@/lib/blog-queue-normalize';
import { attachTopicFitMeta, evaluateBlogTopicFit } from '@/lib/blog-topic-fit-gate';

/**
 * Programmatic SEO Generator — destination × angle × month 매트릭스 promote 크론
 *
 * 흐름:
 *   1) programmatic_seo_topics WHERE status='pending' ORDER BY priority DESC LIMIT N
 *   2) 각 토픽에 대해 llm-gateway('blog-generate') 로 title hint + intro hint 생성
 *      (본문은 blog-publisher 크론이 큐를 소비할 때 풀 본문으로 확장 — 여기는 promote 단계만)
 *   3) blog_topic_queue 에 source='programmatic_seo' 로 INSERT (target_publish_at = NOW + slot offset)
 *   4) programmatic_seo_topics: status='queued', topic_queue_id=새 큐 id, promoted_at=NOW
 *
 * 멱등성:
 *   - status='pending' → 'queued' 단방향 전이 (CHECK 제약). 동일 행이 두 번 처리되지 않음.
 *   - 큐 INSERT 실패 시 토픽 status 롤백 X (다음 회차 재시도 안 됨) — 대신 status='dropped' 로 마킹.
 *
 * vercel.json schedule 추천: "0 4 * * *" (UTC 04:00 = KST 13:00, blog-publisher 02:00 보다 늦게)
 *
 * 인증: Vercel Cron Bearer (CRON_SECRET) — 수동 호출은 ?secret=... 또는 Authorization: Bearer
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_BATCH_DEFAULT = 8;
const MAX_BATCH_HARD = 30;

interface PseoTopic {
  id: string;
  destination: string;
  angle: string;
  month: number | null;
  topic_template: string;
  primary_keyword: string;
  expected_tier: string | null;
  priority: number;
  status: string;
}

interface ProcessResult {
  id: string;
  destination: string;
  angle: string;
  status: 'queued' | 'dropped' | 'failed';
  topic?: string;
  reason?: string;
  topic_queue_id?: string;
}

function clampBatch(raw: string | null): number {
  if (!raw) return MAX_BATCH_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return MAX_BATCH_DEFAULT;
  return Math.min(MAX_BATCH_HARD, Math.max(1, Math.round(n)));
}

/**
 * blog-generate 로 짧은 hint(JSON) 생성. 실패해도 기본 토픽 텍스트로 fallback.
 * publisher cron 이 본문을 풀 길이로 확장하므로 여기선 비용 최소화.
 */
async function generateTopicHint(topic: PseoTopic): Promise<{
  title: string;
  intro: string;
  fallback: boolean;
}> {
  const monthLabel = topic.month ? `${topic.month}월` : '연중';
  const baseTitle = topic.topic_template
    .replace('{destination}', topic.destination)
    .replace('{angle}', topic.angle)
    .replace('{month}', monthLabel);

  const systemPrompt = [
    '당신은 한국 여행 블로그 SEO 카피라이터입니다.',
    '주어진 destination·angle·month·primary keyword 로',
    '클릭률 높은 한국어 제목(45자 이내) + 검색의도에 맞는 인트로 1단락(200자 내외)을 만들어 주세요.',
    '반드시 다음 JSON 만 반환: {"title": "...", "intro": "..."}.',
    '과장·이모지 금지. primary_keyword 는 제목에 자연스럽게 포함.',
  ].join(' ');

  const userPrompt = JSON.stringify({
    destination: topic.destination,
    angle: topic.angle,
    month: topic.month,
    month_label: monthLabel,
    primary_keyword: topic.primary_keyword,
    topic_template: topic.topic_template,
    base_title_hint: baseTitle,
  });

  const result = await llmCall<{ title?: string; intro?: string }>({
    task: 'blog-generate',
    systemPrompt,
    userPrompt,
    maxTokens: 600,
    temperature: 0.7,
    jsonSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        intro: { type: 'string' },
      },
      required: ['title', 'intro'],
    },
  });

  const title = typeof result.data?.title === 'string' && result.data.title.trim()
    ? result.data.title.trim().slice(0, 80)
    : baseTitle;
  const intro = typeof result.data?.intro === 'string' && result.data.intro.trim()
    ? result.data.intro.trim().slice(0, 600)
    : '';

  return {
    title,
    intro,
    fallback: !result.success || !result.data?.title,
  };
}

async function processTopic(
  topic: PseoTopic,
  slotOffsetMin: number,
): Promise<ProcessResult> {
  let hint: Awaited<ReturnType<typeof generateTopicHint>>;
  try {
    hint = await generateTopicHint(topic);
  } catch (err) {
    return {
      id: topic.id,
      destination: topic.destination,
      angle: topic.angle,
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const targetPublishAt = new Date(Date.now() + slotOffsetMin * 60_000).toISOString();

  const queuePayload = normalizeBlogTopicQueueRow(attachTopicFitMeta({
    topic: hint.title,
    source: 'programmatic_seo',
    priority: topic.priority,
    destination: topic.destination,
    angle_type: topic.angle,
    category: 'programmatic',
    target_publish_at: targetPublishAt,
    search_intent: topic.primary_keyword,
    meta: {
      pseo_topic_id: topic.id,
      primary_keyword: topic.primary_keyword,
      month: topic.month,
      expected_tier: topic.expected_tier,
      intro_hint: hint.intro,
      title_fallback: hint.fallback,
    },
  }));
  const topicFit = queuePayload.meta?.topic_fit_gate as ReturnType<typeof evaluateBlogTopicFit> | undefined;
  if (!topicFit?.passed) {
    await supabaseAdmin
      .from('programmatic_seo_topics')
      .update({ status: 'dropped' })
      .eq('id', topic.id);
    return {
      id: topic.id,
      destination: topic.destination,
      angle: topic.angle,
      status: 'dropped',
      reason: `topic_fit_rejected: ${topicFit?.issues.map((issue) => issue.code).join(', ') || 'unknown'}`,
    };
  }

  const { data: queueRows, error: queueErr } = await supabaseAdmin
    .from('blog_topic_queue')
    .insert(queuePayload)
    .select('id')
    .limit(1);

  if (queueErr || !queueRows || queueRows.length === 0) {
    // 큐 INSERT 실패 → status='dropped' 로 마킹해서 무한 재시도 방지
    await supabaseAdmin
      .from('programmatic_seo_topics')
      .update({ status: 'dropped' })
      .eq('id', topic.id);
    return {
      id: topic.id,
      destination: topic.destination,
      angle: topic.angle,
      status: 'dropped',
      topic: hint.title,
      reason: queueErr?.message ?? 'queue insert returned no row',
    };
  }

  const topicQueueId = queueRows[0].id as string;
  const { error: updErr } = await supabaseAdmin
    .from('programmatic_seo_topics')
    .update({
      status: 'queued',
      topic_queue_id: topicQueueId,
      promoted_at: new Date().toISOString(),
    })
    .eq('id', topic.id);

  if (updErr) {
    // Orphan 방어: 큐 INSERT 는 성공했으나 토픽 status 가 'pending' 으로 남았다.
    // 다음 회차 cron 이 같은 토픽을 다시 promote → 큐에 중복 행이 쌓인다.
    // 방금 INSERT 한 큐 행을 롤백해서 토픽 'pending' 상태와 정합시킨다.
    await supabaseAdmin
      .from('blog_topic_queue')
      .delete()
      .eq('id', topicQueueId);
    return {
      id: topic.id,
      destination: topic.destination,
      angle: topic.angle,
      status: 'failed',
      topic: hint.title,
      topic_queue_id: topicQueueId,
      reason: `queue inserted but topic update failed: ${updErr.message} (queue row rolled back)`,
    };
  }

  return {
    id: topic.id,
    destination: topic.destination,
    angle: topic.angle,
    status: 'queued',
    topic: hint.title,
    topic_queue_id: topicQueueId,
  };
}

async function runGenerator(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정' };
  }

  const startedAt = Date.now();
  const limit = clampBatch(request.nextUrl.searchParams.get('limit'));

  // publishing_policies 의 enabled 가 false 면 전체 스킵 (운영자 토글 존중)
  const { data: policyRow } = await supabaseAdmin
    .from('publishing_policies')
    .select('enabled')
    .eq('scope', 'global')
    .limit(1);
  if (policyRow && policyRow[0] && policyRow[0].enabled === false) {
    return {
      skipped: true,
      reason: 'publishing_policies.global.enabled=false',
      processed: 0,
    };
  }

  const { data: topics, error: selectErr } = await supabaseAdmin
    .from('programmatic_seo_topics')
    .select('id, destination, angle, month, topic_template, primary_keyword, expected_tier, priority, status')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (selectErr) {
    return { processed: 0, errors: [`select failed: ${selectErr.message}`] };
  }
  if (!topics || topics.length === 0) {
    return {
      processed: 0,
      message: 'pending pseo topic 없음',
      elapsed_ms: Date.now() - startedAt,
    };
  }

  // 슬롯 분산 — 30분 간격 (publisher 가 다음 회차에 분배 발행하도록)
  const SLOT_GAP_MIN = 30;
  const results: ProcessResult[] = [];
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i] as PseoTopic;
    try {
      const r = await processTopic(topic, (i + 1) * SLOT_GAP_MIN);
      results.push(r);
    } catch (err) {
      results.push({
        id: topic.id,
        destination: topic.destination,
        angle: topic.angle,
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    // 외부 API rate-limit 방어 (rules/external-apis.md §1)
    await new Promise((r) => setTimeout(r, 300));
  }

  const queued = results.filter((r) => r.status === 'queued').length;
  const dropped = results.filter((r) => r.status === 'dropped').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  return {
    processed: results.length,
    queued,
    dropped,
    failed,
    errors: results.filter((r) => r.status === 'failed').map((r) => r.reason ?? `${r.id} failed`),
    elapsed_ms: Date.now() - startedAt,
    results,
  };
}

export const GET = withCronLogging('programmatic-seo-generator', runGenerator);

export const POST = withCronLogging('programmatic-seo-generator', runGenerator);
