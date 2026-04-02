/**
 * @file package-register.ts
 * @description 범용 상품 등록 엔진 (C 파서)
 *
 * 텍스트 복붙 + "랜드사 N%" 한 줄 → 자동 등록
 *
 * 파이프라인:
 * 1. 지역 감지 (destination_masters 키워드 매칭)
 * 2. 블록 매칭 (tour_blocks 키워드 스캔)
 * 3. 가격 추출 (정규식)
 * 4. 일정 원문 파싱 (일자별 분리)
 * 5. 메타데이터 추출 (호텔, 식사, 포함/불포함 등)
 * 6. 정제 레이어 (text-sanitizer)
 * 7. DB INSERT
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any;
import {
  sanitizeText,
  validateExclusions,
  loadNormalizationRules,
  loadExclusionRules,
  buildFullTextForValidation,
} from './text-sanitizer';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface RegisterInput {
  rawText: string;
  landOperator: string;    // '더투어', '투어폰', '랜드부산'
  commissionRate: number;  // 9
}

interface MatchedBlock {
  blockCode: string;
  name: string;
  qualityScore: number;
  keywords: string[];
  matchedKeyword: string;
}

interface ExtractedPrice {
  label: string;
  dates?: string[];
  dayOfWeek?: string;
  price: number;
}

interface DaySchedule {
  day: number;
  regions: string[];
  meals: Record<string, unknown>;
  schedule: Array<{ time: string | null; activity: string; type: string; transport?: string }>;
  hotel: { name: string; grade: string; note: string } | null;
}

interface RegisterResult {
  success: boolean;
  packageId?: string;
  title?: string;
  destination?: string;
  matchedBlocks: MatchedBlock[];
  newBlocksNeeded: string[];
  prices: ExtractedPrice[];
  sanitizeCorrections: Array<{ from: string; to: string }>;
  sanitizeWarnings: Array<{ rule: string; description: string }>;
  error?: string;
}

// ── 지역 감지 ─────────────────────────────────────────────────────────────────

async function detectDestination(
  text: string,
  sb: AnySupabaseClient
): Promise<{ id: string; name: string; data: Record<string, unknown> } | null> {
  const { data: dests } = await sb
    .from('destination_masters')
    .select('*')
    .eq('is_active', true);

  if (!dests?.length) return null;

  let best: { id: string; name: string; data: Record<string, unknown>; score: number } | null = null;

  for (const d of dests) {
    const keywords = (d.keywords as string[]) || [];
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score++;
    }
    // 지역명 직접 매칭은 가중치 3배
    if (text.includes(d.name)) score += 3;

    if (score > 0 && (!best || score > best.score)) {
      best = { id: d.id, name: d.name, data: d, score };
    }
  }

  return best ? { id: best.id, name: best.name, data: best.data } : null;
}

// ── 블록 매칭 ─────────────────────────────────────────────────────────────────

async function matchBlocks(
  text: string,
  destinationId: string,
  sb: AnySupabaseClient
): Promise<{ matched: MatchedBlock[]; unmatched: string[] }> {
  const { data: blocks } = await sb
    .from('tour_blocks')
    .select('block_code, name, keywords, quality_score')
    .eq('destination_id', destinationId)
    .eq('is_active', true);

  if (!blocks?.length) return { matched: [], unmatched: [] };

  const matched: MatchedBlock[] = [];
  const allKeywords = new Set<string>();

  for (const b of blocks) {
    const keywords = (b.keywords as string[]) || [];
    for (const kw of keywords) {
      if (text.includes(kw)) {
        // 중복 방지
        if (!matched.find(m => m.blockCode === b.block_code)) {
          matched.push({
            blockCode: b.block_code,
            name: b.name,
            qualityScore: b.quality_score || 1,
            keywords,
            matchedKeyword: kw,
          });
        }
        allKeywords.add(kw);
        break;
      }
    }
  }

  // 텍스트에서 ▶ 로 시작하는 관광지 중 매칭 안 된 것 추출
  const activities = text.match(/▶[^\n▶]+/g) || [];
  const unmatched: string[] = [];
  for (const act of activities) {
    const isMatched = matched.some(m =>
      m.keywords.some(kw => act.includes(kw))
    );
    if (!isMatched) {
      const clean = act.replace('▶', '').trim().substring(0, 50);
      if (clean && !unmatched.includes(clean)) {
        unmatched.push(clean);
      }
    }
  }

  return { matched, unmatched };
}

// ── 가격 추출 ─────────────────────────────────────────────────────────────────

function extractPrices(text: string): ExtractedPrice[] {
  const prices: ExtractedPrice[] = [];

  // 패턴1: "599,000/인" or "599,000원"
  // 패턴2: "1,259,-" (랜드부산 스타일, 천원단위)
  // 패턴3: 요금표 내 날짜 + 가격 조합

  // 날짜+가격 패턴: "4월 16일 목요일" 근처의 가격
  const dateBlocks = text.split('\n');
  let currentLabel = '';

  for (const line of dateBlocks) {
    const trimmed = line.trim();

    // 날짜 패턴 감지
    const dateMatch = trimmed.match(/(\d{1,2})[\/월]\s*(\d{1,2})[일]?\s*(월|화|수|목|금|토|일)/);
    if (dateMatch) {
      currentLabel = trimmed.substring(0, 30);
    }

    // 가격 패턴: 숫자,숫자,숫자 or 숫자,숫자,-
    const priceMatches = trimmed.match(/(\d{1,3}(?:,\d{3})*(?:,-)?)(?:\s*원|\s*\/인)?/g);
    if (priceMatches) {
      for (const pm of priceMatches) {
        let priceStr = pm.replace(/[원\/인\s]/g, '');
        // 랜드부산 스타일: "1,259,-" → "1,259,000"
        if (priceStr.endsWith(',-')) {
          priceStr = priceStr.replace(',-', ',000');
        }
        const num = parseInt(priceStr.replace(/,/g, ''), 10);
        // 합리적 가격 범위 (30만~500만)
        if (num >= 300000 && num <= 5000000) {
          prices.push({
            label: currentLabel || '전체',
            price: num,
          });
        }
      }
    }
  }

  // 중복 제거
  const unique = prices.filter((p, i) =>
    prices.findIndex(q => q.price === p.price && q.label === p.label) === i
  );

  return unique;
}

// ── 출발일 추출 ───────────────────────────────────────────────────────────────

function extractDepartureDates(text: string): string[] {
  const dates: string[] = [];
  const year = new Date().getFullYear();

  // "4월 16일" or "4/16" or "4/16(목)"
  const patterns = [
    /(\d{1,2})월\s*(\d{1,2})일/g,
    /(\d{1,2})\/(\d{1,2})\s*(?:\(|일|월|화|수|목|금|토)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const month = parseInt(match[1], 10);
      const day = parseInt(match[2], 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (!dates.includes(dateStr)) dates.push(dateStr);
      }
    }
  }

  return dates;
}

// ── 일정 원문 파싱 (제N일 기준 분리) ──────────────────────────────────────────

function parseItineraryDays(text: string): DaySchedule[] {
  const days: DaySchedule[] = [];

  // "제1일" ~ "제N일" 패턴으로 분리
  const dayPattern = /제(\d)일/g;
  const splits: { day: number; start: number }[] = [];
  let match;
  while ((match = dayPattern.exec(text)) !== null) {
    splits.push({ day: parseInt(match[1], 10), start: match.index });
  }

  for (let i = 0; i < splits.length; i++) {
    const start = splits[i].start;
    const end = i + 1 < splits.length ? splits[i + 1].start : text.length;
    const dayText = text.substring(start, end);
    const dayNum = splits[i].day;

    // 지역 추출
    const regions: string[] = [];
    const regionMatch = dayText.match(/(?:부\s*산|장가계|나트랑|달\s*랏|판\s*랑)/g);
    if (regionMatch) {
      for (const r of regionMatch) {
        const clean = r.replace(/\s/g, '');
        if (!regions.includes(clean)) regions.push(clean);
      }
    }

    // 식사 추출
    const meals: Record<string, unknown> = {};
    const breakfastMatch = dayText.match(/조:([^\n]+)/);
    const lunchMatch = dayText.match(/중:([^\n]+)/);
    const dinnerMatch = dayText.match(/석:([^\n]+)/);

    if (breakfastMatch) {
      const bv = breakfastMatch[1].trim();
      meals.breakfast = bv !== '불포함';
      if (meals.breakfast) meals.breakfast_note = bv;
    }
    if (lunchMatch) {
      const lv = lunchMatch[1].trim();
      meals.lunch = lv !== '불포함';
      if (meals.lunch) meals.lunch_note = lv;
    }
    if (dinnerMatch) {
      const dv = dinnerMatch[1].trim();
      meals.dinner = dv !== '불포함';
      if (meals.dinner) meals.dinner_note = dv;
    }

    // 스케줄 추출 (각 줄)
    const schedule: DaySchedule['schedule'] = [];
    const lines = dayText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('제') || trimmed.startsWith('HOTEL') ||
          trimmed.startsWith('조:') || trimmed.startsWith('중:') || trimmed.startsWith('석:') ||
          trimmed.startsWith('날') || trimmed.startsWith('지 역') || trimmed.startsWith('교통') ||
          trimmed.startsWith('시 간') || trimmed.startsWith('주 요') || trimmed.startsWith('식  사')) continue;

      // 항공편 감지
      const flightMatch = trimmed.match(/(BX\d+|7C\d+)/);
      const timeMatch = trimmed.match(/^(\d{2}:\d{2})/);

      if (flightMatch) {
        schedule.push({
          time: timeMatch?.[1] || null,
          activity: trimmed.replace(flightMatch[0], '').trim() || trimmed,
          type: 'flight',
          transport: flightMatch[1],
        });
      } else if (trimmed.startsWith('▶') || trimmed.startsWith('-') || trimmed.length > 5) {
        schedule.push({
          time: timeMatch?.[1] || null,
          activity: trimmed,
          type: 'normal',
        });
      }
    }

    // 호텔 추출
    let hotel: DaySchedule['hotel'] = null;
    const hotelMatch = dayText.match(/HOTEL:\s*(.+?)(?:\n|$)/);
    if (hotelMatch) {
      const hotelStr = hotelMatch[1].trim();
      const gradeMatch = hotelStr.match(/([준정특]?\d성|5성급)/);
      hotel = {
        name: hotelStr.replace(/\(.*\)/, '').trim(),
        grade: gradeMatch?.[1] || '4',
        note: hotelStr.includes('동급') ? '또는 동급' : '',
      };
    }

    days.push({ day: dayNum, regions, meals, schedule, hotel });
  }

  return days;
}

// ── 메타데이터 추출 ───────────────────────────────────────────────────────────

function extractMeta(text: string): {
  title: string;
  duration: number;
  nights: number;
  category: string;
  productType: string;
  tripStyle: string;
  minParticipants: number;
  inclusions: string[];
  excludes: string[];
  accommodations: string[];
  specialNotes: string;
  tags: string[];
  highlights: string[];
} {
  // 박수/일수
  const durationMatch = text.match(/(\d)박(\d)일/);
  const nights = durationMatch ? parseInt(durationMatch[1], 10) : 3;
  const days = durationMatch ? parseInt(durationMatch[2], 10) : 4;

  // 카테고리
  const isGolf = /골프|CC|라운딩/i.test(text);
  const category = isGolf ? '골프' : '패키지';
  const tripStyle = isGolf ? '골프' : '관광';

  // 상품 타입 키워드
  const typeKeywords: string[] = [];
  if (/실속/.test(text)) typeKeywords.push('실속');
  if (/품격/.test(text)) typeKeywords.push('품격');
  if (/고품격/.test(text)) typeKeywords.push('고품격');
  if (/프리미엄|PREMIUM/.test(text)) typeKeywords.push('프리미엄');
  if (/노옵션/.test(text)) typeKeywords.push('노옵션');
  if (/노팁/.test(text)) typeKeywords.push('노팁');
  if (/노쇼핑/.test(text)) typeKeywords.push('노쇼핑');
  if (/특가/.test(text)) typeKeywords.push('특가');

  // 최소 출발인원
  const minMatch = text.match(/(\d+)명\s*이상/);
  const minParticipants = minMatch ? parseInt(minMatch[1], 10) : 4;

  // 포함 사항
  const inclMatch = text.match(/포\s*함[^:\n]*[:：]\s*([^\n]+(?:\n[^\n불선쇼비]*)*)/);
  const inclusions = inclMatch
    ? inclMatch[1].split(/[,，]/).map(s => s.trim()).filter(Boolean)
    : [];

  // 불포함 사항
  const exclMatch = text.match(/불\s*포\s*함[^:\n]*[:：]\s*([^\n]+(?:\n[^\n선쇼비]*)*)/);
  const excludes = exclMatch
    ? exclMatch[1].split(/[,，]/).map(s => s.trim()).filter(Boolean)
    : [];

  // 호텔
  const accomMatch = text.match(/HOTEL:\s*(.+?)(?:\n|$)/);
  const accommodations = accomMatch ? [accomMatch[1].trim()] : [];

  // 비고/특이사항
  const noteMatch = text.match(/비\s*고[^:\n]*[:：]\s*([\s\S]*?)(?=날\s*짜|일\s*자|$)/);
  const specialNotes = noteMatch ? noteMatch[1].trim().substring(0, 500) : '';

  // 타이틀 추출 (첫 번째 줄 또는 PKG 라인)
  const titleMatch = text.match(/(?:PKG|BX)\s*(.+?)\s*(?:\d{4}|\n)/i)
    || text.match(/(.+?)\s*(?:\d)박(\d)일/);
  let title = titleMatch ? titleMatch[1].trim() : '';
  if (!title) {
    const lines = text.split('\n').filter(l => l.trim().length > 10);
    title = lines[0]?.trim().substring(0, 80) || '상품';
  }

  // 태그 자동 생성
  const tags: string[] = [...typeKeywords];
  if (/마사지/.test(text)) tags.push('마사지');
  if (/리무진/.test(text)) tags.push('리무진');
  if (/VIP/.test(text)) tags.push('VIP');
  if (/쿨토시/.test(text)) tags.push('쿨토시증정');
  if (/야경/.test(text)) tags.push('야경');
  if (/대협곡/.test(text)) tags.push('대협곡');

  // 하이라이트
  const highlights: string[] = [];
  if (typeKeywords.includes('노옵션')) highlights.push('노옵션');
  if (typeKeywords.includes('노쇼핑')) highlights.push('노쇼핑');
  if (/VIP/.test(text)) highlights.push('VIP');
  if (/대협곡/.test(text)) highlights.push('대협곡');
  if (/마사지/.test(text)) {
    const massageMatch = text.match(/마사지\s*\(?(\d+분?)\)?/);
    if (massageMatch) highlights.push(`마사지 ${massageMatch[1]}`);
  }

  return {
    title,
    duration: days,
    nights,
    category,
    productType: typeKeywords.join('|') || '패키지',
    tripStyle,
    minParticipants,
    inclusions,
    excludes,
    accommodations,
    specialNotes,
    tags,
    highlights,
  };
}

// ── 메인: 상품 등록 ──────────────────────────────────────────────────────────

export async function registerPackageFromText(
  input: RegisterInput,
  sb: AnySupabaseClient
): Promise<RegisterResult> {
  const { rawText, landOperator, commissionRate } = input;

  try {
    // 1. 정제
    const normRules = await loadNormalizationRules(sb);
    const { sanitizedText, corrections } = sanitizeText(rawText, normRules);

    // 2. 지역 감지
    const dest = await detectDestination(sanitizedText, sb);
    if (!dest) {
      return {
        success: false, matchedBlocks: [], newBlocksNeeded: [],
        prices: [], sanitizeCorrections: corrections, sanitizeWarnings: [],
        error: '지역을 감지할 수 없습니다. destination_masters에 등록된 키워드를 확인하세요.',
      };
    }

    // 3. 블록 매칭
    const { matched, unmatched } = await matchBlocks(sanitizedText, dest.id, sb);

    // 4. 가격 추출
    const prices = extractPrices(sanitizedText);
    const departureDates = extractDepartureDates(sanitizedText);

    // 5. 일정 원문 파싱
    const daySchedules = parseItineraryDays(sanitizedText);

    // 6. 메타데이터 추출
    const meta = extractMeta(sanitizedText);

    // 7. 불포함 가드레일
    const exclCategory = meta.category.includes('골프') || meta.category === 'golf' ? 'golf' : 'tour';
    const exclRules = await loadExclusionRules(sb, exclCategory);
    const fullText = buildFullTextForValidation({
      rawText: sanitizedText,
      excludes: meta.excludes,
      specialNotes: meta.specialNotes,
      inclusions: meta.inclusions,
    });
    const { warnings: exclWarnings } = validateExclusions(fullText, exclRules);

    // 8. 항공 정보 (지역 마스터에서)
    const destData = dest.data as Record<string, unknown>;
    const flightOut = (destData.default_flight_out as string) || 'BX371';
    const flightIn = (destData.default_flight_in as string) || 'BX372';
    const airport = (destData.default_departure_airport as string) || '김해공항';
    const airline = (destData.default_airline as string) || 'BX';

    // 9. price_tiers 구성
    const priceTiers = prices.map((p, i) => {
      const tier: Record<string, unknown> = {
        period_label: p.label || `가격 ${i + 1}`,
        adult_price: p.price,
        status: 'available',
      };
      if (p.dates?.length) tier.departure_dates = p.dates;
      if (p.dayOfWeek) tier.departure_day_of_week = p.dayOfWeek;
      return tier;
    });

    // 출발일이 있으면 price_tiers에 연결
    if (departureDates.length > 0 && priceTiers.length > 0) {
      // 가격이 1개이고 출발일이 여러 개면, 모든 출발일에 같은 가격 적용
      if (priceTiers.length === 1) {
        priceTiers[0].departure_dates = departureDates;
        priceTiers[0].period_label = departureDates.map(d => {
          const dt = new Date(d);
          const dow = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
          return `${dt.getMonth() + 1}/${dt.getDate()} ${dow}`;
        }).join(', ');
      }
    }

    // 10. 타이틀 보강
    const tagStr = meta.tags.filter(t => !meta.title.includes(t)).map(t => `#${t}`).join(' ');
    const fullTitle = `${meta.title} ${tagStr}`.trim().substring(0, 200);

    // 11. product_summary 생성
    const lowestPrice = prices.length > 0 ? Math.min(...prices.map(p => p.price)) : 0;
    const summary = [
      `${dest.name} ${meta.nights}박${meta.duration}일`,
      lowestPrice > 0 ? `${lowestPrice.toLocaleString()}원` : '',
      meta.accommodations[0] || '',
      meta.tags.slice(0, 5).join(', '),
    ].filter(Boolean).join('. ') + '.';

    // 12. itinerary_data 구성
    const itineraryData = {
      meta: {
        title: fullTitle.substring(0, 100),
        destination: dest.name,
        nights: meta.nights,
        days: meta.duration,
        airline,
        flight_out: flightOut,
        flight_in: flightIn,
        departure_airport: airport,
      },
      highlights: {
        inclusions: meta.inclusions.slice(0, 8),
        excludes: meta.excludes.slice(0, 6),
        remarks: meta.tags.filter(t => ['노옵션', '노쇼핑', '노팁'].includes(t)),
      },
      days: daySchedules,
    };

    // 13. DB INSERT
    const { data, error } = await sb.from('travel_packages').insert([{
      title: fullTitle,
      destination: dest.name,
      category: meta.category,
      product_type: meta.productType,
      trip_style: meta.tripStyle,
      departure_airport: airport,
      airline,
      min_participants: meta.minParticipants,
      status: 'approved',
      country: (destData.country as string) || '',
      duration: meta.duration,
      nights: meta.nights,
      price: lowestPrice,
      land_operator: landOperator,
      commission_rate: commissionRate,
      product_summary: summary,
      product_tags: meta.tags,
      product_highlights: meta.highlights,
      price_tiers: priceTiers,
      inclusions: meta.inclusions,
      excludes: meta.excludes,
      accommodations: meta.accommodations,
      special_notes: meta.specialNotes,
      itinerary_data: itineraryData,
      raw_text: rawText,  // 원문 보존
      filename: `auto-${landOperator}-${dest.name}-${Date.now()}`,
      file_type: 'manual',
      confidence: 0.9,  // 자동 파싱이므로 0.9
    }]).select('id, title');

    if (error) {
      return {
        success: false,
        destination: dest.name,
        matchedBlocks: matched,
        newBlocksNeeded: unmatched,
        prices,
        sanitizeCorrections: corrections,
        sanitizeWarnings: exclWarnings,
        error: error.message,
      };
    }

    return {
      success: true,
      packageId: data[0].id,
      title: data[0].title,
      destination: dest.name,
      matchedBlocks: matched,
      newBlocksNeeded: unmatched,
      prices,
      sanitizeCorrections: corrections,
      sanitizeWarnings: exclWarnings,
    };
  } catch (err) {
    return {
      success: false,
      matchedBlocks: [],
      newBlocksNeeded: [],
      prices: [],
      sanitizeCorrections: [],
      sanitizeWarnings: [],
      error: err instanceof Error ? err.message : '알 수 없는 오류',
    };
  }
}
