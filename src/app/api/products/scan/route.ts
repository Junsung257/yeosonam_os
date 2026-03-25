/**
 * POST /api/products/scan
 *
 * 파일 업로드 → AI 분석 → 상품 코드 자동 생성 (미리보기 반환)
 *
 * 흐름:
 *   1) 파일명 파싱   → 랜드사 코드 + 마진율 추출
 *   2) 파일 → 텍스트 → xlsx / pdf / txt 지원
 *   3) Claude AI     → 목적지·출발지·일수·상품명·원가·태그 추출
 *   4) DB 시퀀스 조회 → 마지막 internal_code + 1
 *   5) 미리보기 JSON 반환 (저장은 POST /api/products 에서)
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { supabaseAdmin } from '@/lib/supabase';

// ─── 코드 매핑 테이블 ─────────────────────────────────────────

/** 파일명에서 랜드사 이름 → 약자 코드 변환 */
const SUPPLIER_MAP: Record<string, string> = {
  '투어폰': 'TP',
  '하나투어': 'HN',
  '모두투어': 'MD',
  '노랑풍선': 'NB',
  '롯데관광': 'LT',
  '롯데': 'LT',
  '내일여행': 'NW',
  '참좋은여행': 'CJ',
  '온라인투어': 'OT',
  '세중': 'SJ',
  'KRT': 'KT',
};

/** AI 결과 보완용 출발지 fallback 매핑 */
const REGION_MAP: Record<string, string> = {
  '부산': 'PUS', '김해': 'PUS',
  '인천': 'ICN', '서울': 'ICN',
  '김포': 'GMP',
  '제주': 'CJU',
  '대구': 'TAE',
  '광주': 'KWJ',
  '청주': 'CJJ',
  '무안': 'MWX',
};

/** AI 결과 보완용 목적지 fallback 매핑 */
const DEST_MAP: Record<string, string> = {
  '마카오': 'MAC', '홍콩': 'HKG',
  '방콕': 'BKK', '태국': 'BKK',
  '싱가포르': 'SIN',
  '발리': 'DPS', '인도네시아': 'DPS',
  '도쿄': 'TYO', '오사카': 'OSA', '일본': 'TYO', '후쿠오카': 'FUK', '삿포로': 'CTS',
  '다낭': 'DAD', '하노이': 'HAN', '호치민': 'SGN', '나트랑': 'CXR', '베트남': 'HAN',
  '세부': 'CEB', '마닐라': 'MNL', '필리핀': 'MNL', '보라카이': 'MNL',
  '괌': 'GUM', '사이판': 'SPN', '하와이': 'HNL',
  '파리': 'PAR', '프랑스': 'PAR', '이탈리아': 'ROM', '로마': 'ROM',
  '스페인': 'MAD', '터키': 'IST', '이스탄불': 'IST', '두바이': 'DXB',
  '대만': 'TPE', '타이페이': 'TPE', '타이베이': 'TPE',
  '베이징': 'BJS', '중국': 'BJS', '상하이': 'SHA',
  '서안': 'XIY', '장가계': 'DYG', '계림': 'KWL', '곤명': 'KMG', '청두': 'CTU',
  '몰디브': 'MLE', '스리랑카': 'CMB', '인도': 'DEL',
};

// ─── 파일명 파싱 ──────────────────────────────────────────────

interface FilenameHints {
  supplierCode: string | null;
  supplierName: string | null;
  marginRate: number | null;  // 0.10 = 10%
}

function parseFilename(filename: string): FilenameHints {
  const stem = filename.replace(/\.[^.]+$/, '');

  let supplierCode: string | null = null;
  let supplierName: string | null = null;

  // 1) 랜드사 전체명 탐색 (예: "투어폰_10%.xlsx")
  for (const [name, code] of Object.entries(SUPPLIER_MAP)) {
    if (stem.includes(name)) {
      supplierCode = code;
      supplierName = name;
      break;
    }
  }

  // 2) 이미 약자 형태 (예: "TP_MAC_10%.xlsx")
  if (!supplierCode) {
    const abbr = stem.match(/(?:^|[_\-\s])([A-Z]{2,4})(?:[_\-\s]|$)/);
    if (abbr) supplierCode = abbr[1];
  }

  // 3) 마진율: "10%", "15퍼", "15p" 형태
  const marginMatch = stem.match(/(\d+(?:\.\d+)?)\s*(?:%|퍼|p\b)/i);
  const marginRate = marginMatch ? parseFloat(marginMatch[1]) / 100 : null;

  return { supplierCode, supplierName, marginRate };
}

// ─── 파일 → 원문 텍스트 추출 ─────────────────────────────────

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  // PDF
  if (ext === 'pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }

  // Excel (xlsx / xls / xlsm)
  if (['xlsx', 'xls', 'xlsm'].includes(ext)) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    return wb.SheetNames.map(sheetName => {
      const ws = wb.Sheets[sheetName];
      return `[시트: ${sheetName}]\n` + XLSX.utils.sheet_to_csv(ws);
    }).join('\n\n');
  }

  // 텍스트 계열 (txt, csv 등)
  return buffer.toString('utf-8');
}

// ─── AI 분석 (Claude) ─────────────────────────────────────────

interface AIExtracted {
  destination: string;
  destination_code: string;
  departure_region: string;
  departure_region_code: string;
  duration_days: number;
  display_name: string;
  net_price: number | null;
  departure_date: string | null;  // YYYY-MM-DD or null
  ai_tags: string[];
}

async function analyzeWithClaude(
  rawText: string,
  hints: FilenameHints,
): Promise<AIExtracted> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `당신은 여행사 내부 ERP용 상품 파일 분석 전문가입니다.
문서에서 상품 정보를 추출하여 순수 JSON으로만 응답하세요 (마크다운 코드블록 없이).

규칙:
- destination_code: IATA 도시코드 3자리 대문자 (마카오→MAC, 방콕→BKK 등)
- departure_region_code: 출발 공항코드 (부산/김해→PUS, 인천/서울→ICN, 김포→GMP, 제주→CJU, 대구→TAE, 광주→KWJ)
- duration_days: 여행 총 일수 숫자만 (3박5일→5, 4박6일→6)
- net_price: 원가(도매가) 원화 정수. 달러($)면 ×1350 환산. 없으면 null
- departure_date: 가장 빠른 출발일 YYYY-MM-DD. 없으면 null
- ai_tags: 상품 특징 태그 배열 (예: ["노팁노옵션", "소규모", "실속", "골프포함"])`;

  const userContent = `파일명 힌트:
- 랜드사: ${hints.supplierName ?? '불명'}(코드: ${hints.supplierCode ?? '?'})
- 마진율: ${hints.marginRate !== null ? (hints.marginRate * 100).toFixed(1) + '%' : '파일명에서 추출 불가'}

문서 내용 (앞 3000자):
${rawText.slice(0, 3000)}

아래 JSON 형식으로 추출하세요:
{
  "destination": "목적지 한국어 전체명",
  "destination_code": "MAC",
  "departure_region": "출발지 한국어",
  "departure_region_code": "PUS",
  "duration_days": 5,
  "display_name": "고객 노출용 상품명 (간결하게, 예: 마카오 실속 3박5일)",
  "net_price": 599000,
  "departure_date": "2026-04-15",
  "ai_tags": ["노팁노옵션", "소규모"]
}`;

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  const raw = (message.content[0] as { text: string }).text.trim();
  // 혹시 코드블록이 붙었을 경우 제거
  const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(jsonStr) as AIExtracted;

  // ─ 매핑 테이블 보완: AI가 잘못된 코드를 반환했을 때 fallback
  if (!parsed.destination_code || parsed.destination_code.length !== 3) {
    for (const [key, code] of Object.entries(DEST_MAP)) {
      if (parsed.destination?.includes(key)) {
        parsed.destination_code = code;
        break;
      }
    }
  }
  if (!parsed.departure_region_code || parsed.departure_region_code.length !== 3) {
    for (const [key, code] of Object.entries(REGION_MAP)) {
      if (parsed.departure_region?.includes(key)) {
        parsed.departure_region_code = code;
        break;
      }
    }
  }

  return parsed;
}

// ─── DB 시퀀스 조회 → 다음 internal_code ──────────────────────

async function getNextInternalCode(
  departureCode: string,
  supplierCode: string,
  destinationCode: string,
  durationDays: number,
): Promise<string> {
  // 접두사: "PUS-TP-MAC-05-"
  const prefix =
    departureCode.toUpperCase()
    + '-' + supplierCode.toUpperCase()
    + '-' + destinationCode.toUpperCase()
    + '-' + String(durationDays).padStart(2, '0')
    + '-';

  // 동일 접두사 행 중 시퀀스 최대값 조회
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('internal_code')
    .like('internal_code', `${prefix}%`)
    .order('internal_code', { ascending: false })
    .limit(1);

  if (error) throw new Error(`시퀀스 조회 실패: ${error.message}`);

  let lastSeq = 0;
  if (data && data.length > 0) {
    const lastCode: string = (data[0] as { internal_code: string }).internal_code;
    // 접두사 이후 4자리 숫자 파싱
    const seqStr = lastCode.slice(prefix.length);
    const parsed = parseInt(seqStr, 10);
    if (!isNaN(parsed)) lastSeq = parsed;
  }

  return prefix + String(lastSeq + 1).padStart(4, '0');
}

// ─── Route Handler ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Step 1. 파일명에서 힌트 추출
    const hints = parseFilename(file.name);

    // Step 2. 파일 본문 → 텍스트
    const rawText = await extractText(buffer, file.name);
    if (!rawText.trim()) {
      return NextResponse.json({ error: '파일에서 텍스트를 추출할 수 없습니다.' }, { status: 422 });
    }

    // Step 3. Claude AI 분석
    const ai = await analyzeWithClaude(rawText, hints);

    // Step 4. 코드 구성에 필요한 값 최종 결정
    //   - 랜드사: 파일명 힌트 우선, 없으면 'XX'
    //   - 마진율: 파일명 힌트 우선, 없으면 10%
    const supplierCode  = hints.supplierCode ?? 'XX';
    const supplierName  = hints.supplierName ?? supplierCode;
    const marginRate    = hints.marginRate    ?? 0.10;

    // Step 5. DB 시퀀스 조회 → 다음 internal_code 생성
    const internalCode = await getNextInternalCode(
      ai.departure_region_code,
      supplierCode,
      ai.destination_code,
      ai.duration_days,
    );

    // Step 6. 미리보기 반환 (이 단계에서는 저장 안 함)
    return NextResponse.json({
      preview: {
        internal_code:        internalCode,             // 예: PUS-TP-MAC-05-0005
        display_name:         ai.display_name,
        departure_region:     ai.departure_region,
        departure_region_code: ai.departure_region_code,
        supplier_name:        supplierName,
        supplier_code:        supplierCode,
        destination:          ai.destination,
        destination_code:     ai.destination_code,
        duration_days:        ai.duration_days,
        departure_date:       ai.departure_date,
        net_price:            ai.net_price,
        margin_rate:          marginRate,
        discount_amount:      0,
        // selling_price는 DB GENERATED 컬럼이므로 미리보기용으로만 계산
        selling_price_preview: ai.net_price
          ? Math.round(ai.net_price * (1 + marginRate))
          : null,
        ai_tags:              ai.ai_tags,
        source_filename:      file.name,
      },
      raw_text_preview: rawText.slice(0, 500),
    });

  } catch (error) {
    console.error('[products/scan]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '분석 실패' },
      { status: 500 },
    );
  }
}
