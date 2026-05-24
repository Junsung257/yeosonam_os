/**
 * @file attraction-desc-gen.ts — 관광지 설명 자동 생성
 *
 * Wikidata description 을 short_desc 로,
 * DeepSeek AI 로 long_desc (매력적 1줄 설명) 생성.
 *
 * 정책:
 *   - short_desc: Wikidata description 우선, 없으면 DeepSeek
 *   - long_desc: DeepSeek V4-Flash 로 80~120자 생성
 *   - API 키 없으면 Wikidata description 만 사용 (fail-soft)
 */

import OpenAI from 'openai';
import { getSecret } from '@/lib/secret-registry';

// DeepSeek lazy singleton
let _deepseekClient: OpenAI | null = null;
function getDeepSeek(): OpenAI {
  if (!_deepseekClient) {
    const key = getSecret('DEEPSEEK_API_KEY');
    if (!key) throw new Error('DEEPSEEK_API_KEY 미설정');
    _deepseekClient = new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' });
  }
  return _deepseekClient;
}

export interface AttractionDescription {
  short_desc: string;
  long_desc: string;
}

/**
 * Wikidata description 을 Wikidata API 에서 직접 조회.
 */
async function fetchWikidataDescription(qid: string): Promise<string | null> {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=descriptions&languages=ko|en&format=json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'YeosonamOS/1.0 attraction-desc-gen' } });
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    const entity = (json as any).entities?.[qid];
    if (!entity) return null;
    return entity.descriptions?.ko?.value ?? entity.descriptions?.en?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * DeepSeek 으로 관광지 설명 생성.
 * @returns short_desc (15~25자) + long_desc (80~120자)
 */
async function generateWithAI(
  name: string,
  wdDescription?: string | null,
  destination?: string | null,
): Promise<{ short_desc: string; long_desc: string }> {
  const systemPrompt = `당신은 여행 가이드북 편집자입니다.
관광지의 짧은 설명(short_desc, 15~25자)과 긴 설명(long_desc, 80~120자)을 생성하세요.
- short_desc: 핵심 매력을 한 줄로. 예: "기암괴석이 만든 자연의 조각 작품"
- long_desc: 관광지의 역사/문화적 의미와 여행객이 느낄 감동을 포함해 80~120자.
- 객관적 사실을 바탕으로, 과장 없이 작성.
- 방문객이 왜 가야 하는지 느껴지게.
- JSON 형식으로만 반환.
${wdDescription ? `\n참고: Wikidata 설명 — "${wdDescription}"` : ''}`;

  const userPrompt = `관광지명: ${name}${destination ? `\n위치: ${destination}` : ''}
  
위 관광지의 short_desc (15~25자)와 long_desc (80~120자)를 JSON으로 생성하세요.`;

  try {
    const completion = await getDeepSeek().chat.completions.create({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 500,
      temperature: 0.6,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw) as { short_desc?: string; long_desc?: string };
    return {
      short_desc: parsed.short_desc?.slice(0, 30) || wdDescription?.slice(0, 30) || `${name} 관광명소`,
      long_desc: parsed.long_desc?.slice(0, 120) || '',
    };
  } catch (err) {
    console.warn('[AttractionDesc] AI 생성 실패:', err instanceof Error ? err.message : err);
    return {
      short_desc: wdDescription?.slice(0, 30) || `${name}`,
      long_desc: '',
    };
  }
}

/**
 * 관광지 설명 생성.
 * Wikidata QID 가 있으면 description 조회 후 short_desc 로 사용.
 * long_desc 는 항상 AI 생성 (Wikidata description 이 있어도 AI 로 보강).
 */
export async function generateAttractionDescription(
  name: string,
  options?: {
    qid?: string | null;
    wdDescription?: string | null;
    destination?: string | null;
  },
): Promise<AttractionDescription> {
  // 1) Wikidata description 획득
  let wdDesc = options?.wdDescription ?? null;
  if (!wdDesc && options?.qid) {
    wdDesc = await fetchWikidataDescription(options.qid);
  }

  // 2) AI 생성 시도 (DeepSeek 키 있을 때)
  const hasAi = !!getSecret('DEEPSEEK_API_KEY');
  if (hasAi) {
    const aiDesc = await generateWithAI(name, wdDesc, options?.destination);
    // short_desc 가 비어있으면 Wikidata description 으로 fallback
    if (!aiDesc.short_desc || aiDesc.short_desc === name) {
      aiDesc.short_desc = wdDesc?.slice(0, 30) || name;
    }
    return aiDesc;
  }

  // 3) AI 없으면 Wikidata description 만 반환
  return {
    short_desc: wdDesc?.slice(0, 30) || name,
    long_desc: wdDesc || '',
  };
}

/**
 * 배치: 설명이 없는 attraction 대상 일괄 생성.
 * cron 에서 호출 가능.
 */
export async function batchGenerateDescriptions(
  limit = 30,
): Promise<{ processed: number; success: number }> {
  const { supabaseAdmin, isSupabaseConfigured } = await import('@/lib/supabase');
  if (!isSupabaseConfigured) return { processed: 0, success: 0 };

  const { data: rows, error } = await supabaseAdmin
    .from('attractions')
    .select('id, name, qid, short_desc, region')
    .eq('is_active', true)
    .or('short_desc.eq.NA,short_desc.eq.null,short_desc.eq.""')
    .limit(limit);

  if (error || !rows) return { processed: 0, success: 0 };

  let success = 0;
  for (const row of rows as Array<{ id: string; name: string; qid: string | null; short_desc: string | null; region: string | null }>) {
    try {
      const desc = await generateAttractionDescription(row.name, {
        qid: row.qid,
        destination: row.region,
      });
      await supabaseAdmin
        .from('attractions')
        .update({
          short_desc: desc.short_desc,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      success++;
      await new Promise(r => setTimeout(r, 200)); // rate limit
    } catch {
      continue;
    }
  }

  return { processed: rows.length, success };
}
