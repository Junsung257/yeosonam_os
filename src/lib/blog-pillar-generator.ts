/**
 * Destination Pillar 자동 생성기
 *
 * 용도:
 *   /destinations/[city] 의 본문(pillar)을 AI 로 생성.
 *   attractions + packages + active 시즌 정보 집계 → Gemini 호출.
 *
 * 호출 시점:
 *   1) 주간 scheduler 가 coverage gap 분석 후 "pillar 없음" 발견 시 큐에 주입
 *   2) 어드민에서 수동 재생성 트리거 가능 (/admin/destinations)
 *
 * 출력:
 *   content_creatives 에 content_type='pillar', pillar_for=destination 으로 저장
 *   → /destinations/[city] 페이지가 이걸 렌더
 */

import { supabaseAdmin } from './supabase';

export interface PillarGenerationInput {
  destination: string;
}

export async function queuePillarGeneration(input: PillarGenerationInput): Promise<{ queued: boolean; reason?: string }> {
  const { destination } = input;

  // 이미 pillar 존재?
  const { data: existing } = await supabaseAdmin
    .from('content_creatives')
    .select('id')
    .eq('content_type', 'pillar')
    .eq('pillar_for', destination)
    .in('status', ['published', 'draft', 'scheduled'])
    .limit(1);

  if (existing && existing.length > 0) {
    return { queued: false, reason: 'pillar already exists' };
  }

  // 큐 중복 체크
  const { data: queued } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id')
    .eq('source', 'pillar')
    .eq('destination', destination)
    .in('status', ['queued', 'generating'])
    .limit(1);

  if (queued && queued.length > 0) {
    return { queued: false, reason: 'pillar already queued' };
  }

  // 큐 등록 (최상위 우선순위)
  const { error } = await supabaseAdmin.from('blog_topic_queue').insert({
    topic: `${destination} 여행 완벽 가이드 (Pillar)`,
    source: 'pillar',
    priority: 95,
    destination,
    category: 'pillar',
    meta: { pillar_for: destination },
    target_publish_at: new Date().toISOString(), // 다음 publisher 크론에 즉시 처리
  });

  if (error) return { queued: false, reason: error.message };
  return { queued: true };
}

/**
 * 활성 destination 중에 Pillar 없는 것들을 모두 큐잉
 * scheduler 크론에서 호출
 */
export async function ensureAllDestinationsHavePillar(): Promise<{ queued: number; skipped: number }> {
  const { data: dests } = await supabaseAdmin
    .from('active_destinations')
    .select('destination');

  let queued = 0;
  let skipped = 0;

  for (const d of ((dests || []) as Array<{ destination: string }>)) {
    const result = await queuePillarGeneration({ destination: d.destination });
    if (result.queued) queued++;
    else skipped++;
  }

  return { queued, skipped };
}

/**
 * Pillar 생성용 컨텍스트 수집 (publisher 에서 호출)
 */
export async function buildPillarContext(destination: string): Promise<{
  attractions: string[];
  packageSummary: string;
  priceRange: string;
  airlines: string[];
  seasonHint: string;
} | null> {
  const [{ data: attrs }, { data: pkgs }] = await Promise.all([
    supabaseAdmin.from('attractions').select('name, short_desc').eq('destination', destination).limit(12),
    supabaseAdmin.from('travel_packages').select('title, price, airline, duration, nights').eq('destination', destination).in('status', ['approved', 'active']).order('price', { ascending: true }).limit(10),
  ]);

  if ((!attrs || attrs.length === 0) && (!pkgs || pkgs.length === 0)) return null;

  const attractions = ((attrs || []) as Array<{ name: string; short_desc?: string }>)
    .map(a => a.short_desc ? `${a.name}(${a.short_desc.slice(0, 30)})` : a.name);

  const prices = ((pkgs || []) as any[]).map(p => p.price).filter((p): p is number => !!p);
  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 0;
  const priceRange = minP && maxP ? `${Math.round(minP / 10000)}만원 ~ ${Math.round(maxP / 10000)}만원` : '미정';

  const airlines = Array.from(new Set(((pkgs || []) as any[]).map(p => p.airline).filter(Boolean))) as string[];
  const packageSummary = `활성 패키지 ${pkgs?.length || 0}개 · ${priceRange}`;

  const month = new Date().getMonth() + 1;
  const season = month <= 2 ? '겨울' : month <= 5 ? '봄' : month <= 8 ? '여름' : month <= 11 ? '가을' : '겨울';
  const seasonHint = `현재 ${month}월 (${season})`;

  return { attractions, packageSummary, priceRange, airlines, seasonHint };
}
