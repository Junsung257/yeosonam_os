'use client';

import { useMemo, useState } from 'react';
import { generateCreativeId, injectRagContext } from '@/lib/ad-brain';

// ── 타입 ─────────────────────────────────────────────────
interface PriceTier {
  period_label?: string;
  adult_price?: number;
  child_price?: number;
  status?: string;
  departure_dates?: string[];
  note?: string;
}

interface PromptPkg {
  title?: string;
  display_name?: string;
  destination?: string;
  duration?: number;
  airline?: string;
  departure_airport?: string;
  departure_days?: string;
  product_type?: string;
  price?: number;
  price_tiers?: PriceTier[];
  inclusions?: string[];
  excludes?: string[];
  product_highlights?: string[];
  product_summary?: string;
  special_notes?: string;
  itinerary?: string[];
}

interface MarketingPromptGeneratorProps {
  pkg: PromptPkg;
  onClose: () => void;
}

// ── 데이터 파싱 유틸 ─────────────────────────────────────
function extractLowestPrice(pkg: PromptPkg): string {
  const prices: number[] = [];
  if (pkg.price && pkg.price > 0) prices.push(pkg.price);
  if (pkg.price_tiers) {
    for (const tier of pkg.price_tiers) {
      if (tier.adult_price && tier.adult_price > 0) prices.push(tier.adult_price);
    }
  }
  if (prices.length === 0) return '가격 미정';
  const min = Math.min(...prices);
  return `₩${min.toLocaleString()}`;
}

function buildPriceTierSummary(tiers?: PriceTier[]): string {
  if (!tiers || tiers.length === 0) return '- 가격 정보 없음';
  return tiers.map(t => {
    const dates = t.departure_dates?.join(', ') || t.period_label || '미정';
    const price = t.adult_price ? `₩${t.adult_price.toLocaleString()}` : '문의';
    const status = t.status === 'available' ? '예약가능' : t.status === 'soldout' ? '마감' : t.status || '';
    return `- ${dates}: 성인 ${price} ${status}`;
  }).join('\n');
}

function buildInclusionsSummary(items?: string[]): string {
  if (!items || items.length === 0) return '- 정보 없음';
  return items.map(item => `- ${item}`).join('\n');
}

// ── 프롬프트 템플릿 조립 ─────────────────────────────────
function generatePrompt(pkg: PromptPkg): string {
  const title = pkg.display_name || pkg.title || '상품명 미입력';
  const dest = pkg.destination || '목적지 미정';
  const duration = pkg.duration ? `${pkg.duration}일` : '미정';
  const airline = pkg.airline || '미정';
  const airport = pkg.departure_airport || '미정';
  const lowestPrice = extractLowestPrice(pkg);
  const productType = pkg.product_type || '패키지';

  return `# 마케팅 카피 생성 지시서

## 페르소나
너는 10년 차 여행 전문 퍼포먼스 마케터다. '여소남(가치 있는 프리미엄 여행)'의 톤앤매너로 신뢰감 있고 후킹한 카피를 써라.

## 상품 데이터

**상품명:** ${title}
**목적지:** ${dest}
**기간:** ${duration}
**출발지:** ${airport}
**항공:** ${airline}
**상품 유형:** ${productType}
**최저가:** ${lowestPrice}

### 출발일별 요금
${buildPriceTierSummary(pkg.price_tiers)}

### 포함 사항 (핵심 소구점)
${buildInclusionsSummary(pkg.inclusions)}

### 불포함 사항
${buildInclusionsSummary(pkg.excludes)}

${pkg.product_highlights?.length ? `### 상품 하이라이트\n${pkg.product_highlights.map(h => `- ${h}`).join('\n')}` : ''}
${pkg.product_summary ? `### 상품 요약\n${pkg.product_summary}` : ''}
${pkg.special_notes ? `### 유의사항\n${pkg.special_notes}` : ''}

---

## AB 테스트 소구점 분할 지시

이 하나의 상품으로 서로 다른 타겟과 소구점을 가진 **3개의 독립된 광고 컨셉**을 기획해라:

1. **가성비 소구** — 가격 대비 혜택을 강조, 2030 직장인 타겟
2. **효도여행 소구** — 부모님 모시고 편안한 여행, 3040 자녀 타겟
3. **럭셔리/호캉스 소구** — 프리미엄 호텔·특식 강조, 고소득 커플 타겟

## 출력 규칙

- 각 컨셉별로 **인스타그램 카드뉴스 5장 분량**의 스토리보드를 기획해라.
- 반드시 아래의 **JSON 배열 형식으로만** 출력해라. 다른 설명은 일절 하지 마라.
- 브랜드명은 반드시 "여소남"으로 통일. 랜드사명/원가/커미션 절대 언급 금지.
- 호텔명, 관광지, 항공사 등 구체적 셀링포인트를 반드시 1개 이상 포함해라.

## 출력 JSON 포맷

\`\`\`json
[
  {
    "concept_name": "가성비 직장인 패키지",
    "target_audience": "25~35세 직장인, 가격 민감 타겟",
    "hook_angle": "이 가격에 이 퀄리티?",
    "slides": [
      {
        "slide_num": 1,
        "type": "hook",
        "image_hint": "목적지 대표 풍경 사진",
        "hook_copy": "스크롤 멈출 한 줄 (15자 이내)",
        "main_text": "본문 카피 (50자 이내)"
      },
      {
        "slide_num": 2,
        "type": "benefit",
        "image_hint": "호텔 또는 식사 사진",
        "hook_copy": "핵심 혜택 한 줄",
        "main_text": "상세 설명"
      },
      {
        "slide_num": 3,
        "type": "itinerary",
        "image_hint": "관광지 사진",
        "hook_copy": "일정 요약",
        "main_text": "하이라이트 일정"
      },
      {
        "slide_num": 4,
        "type": "price",
        "image_hint": "가격 강조 그래픽",
        "hook_copy": "가격 소구 한 줄",
        "main_text": "출발일별 가격 정보"
      },
      {
        "slide_num": 5,
        "type": "cta",
        "image_hint": "브랜드 로고 + CTA",
        "hook_copy": "행동 유도 한 줄",
        "main_text": "예약 방법 안내"
      }
    ]
  }
]
\`\`\`

위 포맷으로 3개 컨셉 (가성비/효도/럭셔리) 모두 출력해라. JSON 외 텍스트는 절대 출력하지 마라.`;
}

// ── 컴포넌트 ─────────────────────────────────────────────
export default function MarketingPromptGenerator({ pkg, onClose }: MarketingPromptGeneratorProps) {
  const creativeId = useMemo(() => generateCreativeId(pkg.display_name || pkg.title || '상품'), [pkg]);
  const basePrompt = useMemo(() => generatePrompt(pkg), [pkg]);
  const prompt = useMemo(() => {
    const dest = pkg.destination || '';
    const withRag = injectRagContext(basePrompt, dest);
    // creative_id 주입
    return withRag.replace(
      '## 출력 JSON 포맷',
      `## Tracking ID\n이번 기획안의 Creative ID: **${creativeId}**\n캠페인 이름에 반드시 이 ID를 포함시켜라.\n\n## 출력 JSON 포맷`
    );
  }, [basePrompt, pkg.destination, creativeId]);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const title = pkg.display_name || pkg.title || '상품';
  const lowestPrice = extractLowestPrice(pkg);
  const dest = pkg.destination || '-';
  const duration = pkg.duration ? `${pkg.duration}일` : '-';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl bg-white shadow-xl border-l border-slate-200 h-full flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-admin-lg font-semibold text-slate-800">마케팅 프롬프트 생성기</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">상품 데이터 → AI 지시서 자동 조립</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 transition">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* 상품 요약 카드 */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0">
              AD
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-admin-base font-semibold text-slate-800 truncate">{title}</p>
              <div className="flex gap-2 mt-0.5">
                <span className="text-[11px] text-slate-500">{dest}</span>
                <span className="text-[11px] text-slate-400">|</span>
                <span className="text-[11px] text-slate-500">{duration}</span>
                <span className="text-[11px] text-slate-400">|</span>
                <span className="text-[11px] font-medium text-[#005d90]">{lowestPrice}~</span>
                <span className="text-[11px] text-slate-400">|</span>
                <span className="text-[11px] font-mono text-slate-500">{creativeId}</span>
              </div>
            </div>
          </div>

          {/* 소구점 미리보기 */}
          <div className="flex gap-1.5 mt-2">
            {['가성비', '효도여행', '럭셔리'].map(tag => (
              <span key={tag} className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[10px] text-slate-600">
                {tag}
              </span>
            ))}
            <span className="px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-[10px] text-blue-600">
              5장 × 3컨셉 = 15장
            </span>
          </div>
        </div>

        {/* 프롬프트 출력 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">생성된 프롬프트</span>
            <span className="text-[10px] text-slate-400">{prompt.length.toLocaleString()}자</span>
          </div>
          <textarea
            readOnly
            value={prompt}
            className="w-full h-[calc(100%-2rem)] bg-slate-50 border border-slate-200 rounded-lg p-4 text-admin-xs text-slate-700 font-mono leading-relaxed resize-none focus:ring-1 focus:ring-[#005d90] focus:border-[#005d90]"
          />
        </div>

        {/* 하단 액션 */}
        <div className="bg-white border-t border-slate-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
          <p className="text-[11px] text-slate-400">
            {copied ? '클립보드에 복사되었습니다' : 'AI 채팅에 붙여넣기 하세요'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-admin-sm rounded hover:bg-slate-50 transition"
            >
              닫기
            </button>
            <button
              onClick={handleCopy}
              className={`px-5 py-2 text-admin-sm rounded font-medium transition ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-900'
              }`}
            >
              {copied ? '복사 완료' : '클립보드 복사'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
