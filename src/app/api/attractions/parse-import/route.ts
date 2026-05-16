/**
 * POST /api/attractions/parse-import
 *
 * STRICT SSOT (PR #90 Phase 2c):
 *   사장님이 하나투어/모두투어/MRT 페이지를 통째로 paste → DeepSeek 으로 attraction 후보 카드 추출.
 *   ⚠️ 추출만 함, 자동 INSERT 안 함. 사장님이 어드민에서 카드 보고 ☑ 선택 → /api/attractions POST 일괄.
 *
 * 입력: { text: string, region?: string, country?: string }
 * 출력: { cards: [{ name, short_desc, badge_type, emoji, aliases }], llm_meta: { provider, model } }
 *
 * 사장님 톤 가이드: 친근/구체/소통. 슬래시 나열 금지. 외부 카탈로그 원문 → 사장님 톤으로 짧은 hook 변환.
 */
import { NextRequest, NextResponse } from 'next/server';
import { llmCall } from '@/lib/llm-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYSTEM_PROMPT = `당신은 한국 패키지 여행 ERP의 attraction(관광지) 카탈로그 추출 도우미입니다.

사장님이 하나투어/모두투어/MRT 같은 외부 카탈로그 페이지를 통째로 paste 하면,
당신은 그 안에서 진짜 관광지(POI)만 골라 카드 배열로 반환합니다.

규칙:
1. 진짜 관광지만 추출. 호텔/식당/투어/공항 픽업/와이파이/eSIM 같은 서비스는 제외.
2. 한 라인이 verbatim 서술이면 그 안의 캐노니컬 명사만 추출 (예: "양귀비와 당현종의 로맨스장소인 화청지" → "화청지").
3. 짧은 설명(short_desc)은 한국어 친근/구체 톤 1줄 (15~40자). 슬래시 나열 금지.
4. 활동성 표현 trailing 제거 ("1일투어", "왕복포함", "체험" 등).
5. 같은 attraction 중복 안 나오게.

응답: JSON 배열만. 다른 텍스트 금지.
[
  {"name": "병마용", "short_desc": "2200년 지하군단의 세계 8대 불가사의", "badge_type": "tour", "emoji": "🏛️", "aliases": ["Terracotta Army", "병마용갑"]},
  ...
]

badge_type 가능값: tour | special | shopping | meal | optional | hotel | restaurant | golf | activity | onsen
emoji 는 1글자만. 없으면 빈 문자열.
aliases 는 한국어/영어/중국어 다른 표기 (외부 카탈로그에서 보이는 그대로).`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = (body.text ?? '').toString();
    const region = (body.region ?? '').toString().trim();
    const country = (body.country ?? '').toString().trim();
    if (text.length < 50) {
      return NextResponse.json({ error: 'paste 텍스트가 너무 짧습니다 (50자 이상 필요)' }, { status: 400 });
    }
    if (text.length > 30000) {
      return NextResponse.json({ error: 'paste 텍스트가 너무 깁니다 (30000자 이하)' }, { status: 400 });
    }

    const userPrompt = `다음 카탈로그 페이지에서 attraction 카드를 추출하세요.
지역: ${region || '미지정'} ${country ? `(${country})` : ''}

원문:
${text}

JSON 배열만 응답:`;

    const result = await llmCall<unknown>({
      task: 'extract-meta',
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 4000,
    });

    if (!result.success) {
      return NextResponse.json({ error: `LLM 호출 실패: ${result.errors?.join(', ') ?? 'unknown'}` }, { status: 502 });
    }

    // result.data 가 이미 파싱되었거나, rawText 에 JSON 문자열
    let cards: Array<{ name: string; short_desc?: string; badge_type?: string; emoji?: string; aliases?: string[] }> = [];
    const raw = (result.data ?? result.rawText) as unknown;
    try {
      if (Array.isArray(raw)) {
        cards = raw as typeof cards;
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
        cards = JSON.parse(trimmed) as typeof cards;
      } else if (raw && typeof raw === 'object') {
        // {cards: [...]} 또는 {result: [...]} 형태
        const obj = raw as Record<string, unknown>;
        cards = (obj.cards ?? obj.result ?? obj.attractions ?? []) as typeof cards;
      }
    } catch (e) {
      console.error('[parse-import] JSON parse 실패:', e);
      return NextResponse.json({ error: 'LLM 응답 JSON 파싱 실패', raw_preview: String(raw).slice(0, 500) }, { status: 502 });
    }

    // 필수 필드 검증 + clean
    const validCards = cards
      .filter(c => c && typeof c.name === 'string' && c.name.trim().length >= 2)
      .map(c => ({
        name: c.name.trim(),
        short_desc: (c.short_desc ?? '').toString().trim() || null,
        badge_type: c.badge_type ?? 'tour',
        emoji: (c.emoji ?? '').toString().trim() || '📍',
        aliases: Array.isArray(c.aliases) ? c.aliases.filter((a): a is string => typeof a === 'string' && a.length >= 2) : [],
        country: country || null,
        region: region || null,
      }));

    return NextResponse.json({
      cards: validCards,
      llm_meta: {
        provider: result.provider,
        model: result.model,
        elapsed_ms: result.elapsed_ms,
      },
    });
  } catch (error) {
    console.error('[parse-import] 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '실패' }, { status: 500 });
  }
}
