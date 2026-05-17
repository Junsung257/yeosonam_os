import { NextRequest, NextResponse, after as nextAfter } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createHash } from 'crypto';
import { parseDocument, calculateConfidence, calculateConfidenceV2, classifyDocument, type ParseOptions } from '@/lib/parser';
import { sanitizeForCustomer } from '@/lib/customer-leak-sanitizer';
import { normalizeFlightSegments } from '@/lib/parser/normalize-flight-segments';
import { normalizeItinerary } from '@/lib/itinerary-normalizer';
import { runCoVeInBackground } from '@/lib/cove-audit-bridge';
import { runAutoMobileQA } from '@/lib/auto-mobile-qa';
import { runAutoPhotoMatch } from '@/lib/auto-photo-match';
import { runUploadVerify } from '@/lib/upload-verify';
import { normalizeOptionalTours } from '@/lib/package-acl';
import { getRegistrationPolicy } from '@/lib/registration-policy';
void calculateConfidence; // V1 deprecated — V2 사용. unused import 경고 회피용.
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { generateMarketingCopies, type MarketingCopy } from '@/lib/ai';
import {
  validateExtractedProduct,
  priceTiersToRows,
  determineProductStatus,
  classifyUploadGate,
  applyDeterministicExtractedDataFixes,
  type UploadGate,
} from '@/lib/upload-validator';
import { repairExtractedDataWithGemini } from '@/lib/parser/extracted-field-repair';
import { tiersToDatePrices } from '@/lib/price-dates';
import { getRelevantReflections } from '@/lib/reflection-memory';
import { getRegionCacheContext } from '@/lib/region-cache-context';
import { getLandOperatorProfile, accumulateLandOperatorProfile } from '@/lib/land-operator-profile';
import { computeNormalizedContentHash } from '@/lib/parser/upload-text-hash';
import type { AttractionData } from '@/lib/attraction-matcher';
import { extractAttractionCandidates } from '@/lib/itinerary-attraction-candidates';
import { enrichItineraryWithAttractionReferences, type ItineraryDataLike } from '@/lib/itinerary-attraction-enricher';
import { extractPriceTable } from '@/lib/parser/deterministic/price-table';
import { detectFerry } from '@/lib/parser/deterministic/ferry-classifier';
import { extractBullets } from '@/lib/parser/deterministic/bullets';
import { extractNotices } from '@/lib/parser/deterministic/notices';
import { maybeTriggerMrtSync } from '@/lib/parser/mrt-lazy-sync';
import { recordHotelsFromItinerary } from '@/lib/parser/hotel-canonical-learner';
import { detectIssues as detectCriticIssues, autoFixIssues as autoFixCriticIssues } from '@/lib/parser/critic';
import { parseSections, classifyItem as classifyByContext } from '@/lib/parser/section-aware-parser';
import { recordSignal, lookupSignal } from '@/lib/parser/classification-signals';
import { generateRecommendationCopy, isWeakCopy } from '@/lib/parser/recommendation-copy';
import { getSecret } from '@/lib/secret-registry';
import { getPrompt } from '@/lib/prompt-loader';

const ATTRACTION_EXTRACT_FALLBACK = `아래 여행 일정 텍스트에서 핵심 관광지/활동명을 추출하고, 1줄 설명과 이모지를 반환하세요.

★ name 규칙 (가장 중요):
- name은 반드시 2~6자의 짧은 핵심 키워드만. 수식어/설명 절대 포함 금지.
- 입력: "절벽에 새겨진 황금불상 황금절벽사원 및 코끼리트래킹" → name: "황금절벽사원" (수식어 제거)
- 입력: "방콕의 현대식 야시장 아시아티크" → name: "아시아티크" (수식어 제거)
- 입력: "태국에서 가장 오래된 왓포사원" → name: "왓포사원" (수식어 제거)
- 입력: "호텔 투숙 및 휴식" → skip: true (관광지 아님)
- 입력: "파타야로 이동" → skip: true (이동)

카테고리: sightseeing|temple|market|museum|nature|palace|shopping|entertainment|park|beach|cultural
관광 활동이 아닌 항목(이동, 수속, 호텔체크인, 자유시간, 휴식, 조식, 체크아웃, 공항이동 등)은 skip:true.

목록:
{{names_list}}

반환 형식 (JSON 배열만, 마크다운 없이):
[{"name":"짧은키워드","desc":"매력적 1줄 설명(15~25자)","category":"sightseeing","emoji":"🏛️","skip":false}]`;

/** 파싱 실패·BLOCKED 건 DLQ (비동기 적재, 실패해도 업로드 응답은 유지) */
function scheduleUploadReviewInsert(row: {
  severity?: string;
  status?: string;
  error_reason?: string | null;
  source_filename?: string | null;
  file_hash?: string | null;
  normalized_content_hash?: string | null;
  raw_text_chunk?: string | null;
  parsed_draft_json?: Record<string, unknown> | null;
  product_title?: string | null;
  land_operator_id?: string | null;
}) {
  if (!isSupabaseConfigured) return;
  void supabaseAdmin
    .from('upload_review_queue')
    .insert(row)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn('[Upload API] upload_review_queue 적재 실패(비중단):', error.message);
    });
}

// ─── 민감정보 마스킹 (raw_extracted_text → 블로그/카드뉴스용) ─────────────────

const SENSITIVE_KEYWORDS = /커미션|마진|수수료|net가|NET가|랜드비|원가|이익률|마진율|랜드가|행사가|랜드비용|수익/;

function maskSensitiveRawText(rawText: string, landOperatorName?: string): string {
  let masked = rawText;

  // 1. 랜드사명 → 여소남 (브랜드 일관성)
  if (landOperatorName && landOperatorName.length > 1) {
    const escaped = landOperatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    masked = masked.replace(new RegExp(escaped, 'gi'), '여소남');
  }

  // 2. 민감 줄 전체 삭제 (금액이 함께 있을 때만) + 연속 빈 줄 압축
  masked = masked
    .split('\n')
    .filter(line => !(SENSITIVE_KEYWORDS.test(line) && /\d/.test(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return masked;
}

// ─── 코드 매핑 테이블 ─────────────────────────────────────────────────────────

/** 랜드사 한글명 → 약자 코드 (부분 문자열 매칭용 — 긴 이름 먼저 배치) */
const SUPPLIER_MAP: Record<string, string> = {
  '참좋은여행': 'CJ', '온라인투어': 'OL', '베스트아시아': 'BA',
  '노랑풍선': 'NY',   '롯데관광': 'LO',   '교원투어': 'KW',
  '인터파크': 'IP',   '여행박사': 'YB',   '자유투어': 'JY',
  '세중나모': 'SJ',   '하나투어': 'HN',   '모두투어': 'MD',
  '투어폰': 'TP',     '투어비': 'TB',
};

// ─── 자가 학습 랜드사 식별 결과 타입 ─────────────────────────────────────────

interface SupplierIdentificationResult {
  supplierRaw: string | null;
  supplierCode: string;
  landOperatorId: string | null;
  identificationSource: 'filename' | 'text_regex' | 'rag_flywheel' | 'llm_inference' | 'unknown';
}

/** 출발지/공항명 → IATA 코드 */
const REGION_CODE_MAP: Record<string, string> = {
  '부산': 'PUS', '김해': 'PUS', '인천': 'ICN', '서울': 'ICN',
  '김포': 'GMP', '제주': 'CJU', '대구': 'TAE', '청주': 'CJJ', '광주': 'KWJ',
};

/** 목적지(한국어) → 3자리 코드 */
const DEST_CODE_MAP: Record<string, string> = {
  // 일본
  '오사카': 'OSA', '도쿄': 'TYO', '후쿠오카': 'FUK', '삿포로': 'CTS', '오키나와': 'OKA',
  // 동남아
  '방콕': 'BKK', '치앙마이': 'CNX', '싱가포르': 'SIN', '마카오': 'MAC',
  '홍콩': 'HKG', '대만': 'TPE', '타이페이': 'TPE', '베트남': 'SGN',
  '하노이': 'HAN', '다낭': 'DAD', '호치민': 'SGN', '나트랑': 'CXR', '푸꾸옥': 'PQC',
  '세부': 'CEB', '마닐라': 'MNL', '발리': 'DPS', '쿠알라룸푸르': 'KUL',
  '양곤': 'RGN', '미얀마': 'RGN',
  // 중국
  '장가계': 'DYG', '장자제': 'DYG', '봉황고성': 'DYG',
  '계림': 'KWL', '구이린': 'KWL', '양삭': 'KWL',
  '북경': 'PEK', '베이징': 'PEK',
  '상해': 'SHA', '상하이': 'SHA',
  '청두': 'CTU', '성도': 'CTU',
  '연길': 'YNJ', '백두산': 'YNJ', '장백산': 'YNJ',
  '황산': 'HFE',
  '곤명': 'KMG', '쿤밍': 'KMG',
  '서안': 'XIY', '시안': 'XIY',
  '중경': 'CKG', '충칭': 'CKG',
  '우루무치': 'URC',
  // O4 박제 (2026-05-16 ERR-청도-UNK): 청도/칭다오 누락으로 internal_code UNK 박힘 사고 차단.
  // 호이안/보홀 등 자주 사고 나는 누락 도시 추가.
  '청도': 'TAO', '칭다오': 'TAO',
  '호이안': 'HOI',
  '보홀': 'BOH',
  '보라카이': 'MPH',
  '코타키나발루': 'BKI',
  '카오슝': 'KHH', '가오슝': 'KHH',
  // 태평양/하와이
  '괌': 'GUM', '사이판': 'SPN', '하와이': 'HNL',
  // 중동/유럽
  '두바이': 'DXB', '아부다비': 'AUH', '이스탄불': 'IST',
  '런던': 'LHR', '파리': 'CDG', '모스크바': 'SVO',
};

// ─── 유틸리티 ─────────────────────────────────────────────────────────────────

/**
 * 파일명에서 랜드사명·마진율을 유연하게 추출합니다.
 *
 * 지원 형식:
 *   형식 1 (대괄호): [투어비_10%]오사카.pdf
 *   형식 2 (언더바): 투어비_오사카_9%.pdf  /  하나투어_9%_다낭.pdf
 *
 * 반환:
 *   supplierRaw  — SUPPLIER_MAP 조회용 원문 랜드사명 (또는 undefined)
 *   marginRate   — 소수점 비율 (9% → 0.09, 없으면 undefined)
 *   cleanName    — 확장자 제거한 파일 기본명
 */
function parseFilename(filename: string): {
  supplierRaw?: string;
  marginRate?: number;
  cleanName: string;
} {
  const base      = filename.replace(/\.\w+$/, '');   // 확장자 제거
  const pctMatch  = filename.match(/(\d+(?:\.\d+)?)%/); // 숫자+% 추출
  const marginRate = pctMatch ? parseFloat(pctMatch[1]) / 100 : undefined;

  // ── 형식 1: [랜드사_마진%]상품명  ──────────────────────────────────
  const bracketMatch = filename.match(/^\[([^_\]]+)_\d+(?:\.\d+)?%?\](.+)\.\w+$/);
  if (bracketMatch) {
    return {
      supplierRaw: bracketMatch[1].trim(),
      marginRate,
      cleanName:   bracketMatch[2].trim(),
    };
  }

  // ── 형식 2: 언더바 구분 (랜드사_목적지_마진% 또는 랜드사_마진%_목적지) ──
  // SUPPLIER_MAP 키를 파일명에서 부분 문자열로 검색
  let supplierRaw: string | undefined;
  for (const key of Object.keys(SUPPLIER_MAP)) {
    if (base.includes(key)) { supplierRaw = key; break; }
  }

  return { supplierRaw, marginRate, cleanName: base };
}

/**
 * 랜드사 원문명 → supplier_code
 * 매핑 사전 우선, 없으면 파일명 전체에서 부분 문자열 재탐색, 최종 fallback 'ETC'
 */
function resolveSupplierCode(supplierRaw?: string): string {
  if (!supplierRaw) return 'ETC';
  // 정확한 키 매칭
  if (SUPPLIER_MAP[supplierRaw]) return SUPPLIER_MAP[supplierRaw];
  // 부분 문자열 매칭 (예: '투어폰여행사' → 'TP')
  for (const [key, code] of Object.entries(SUPPLIER_MAP)) {
    if (supplierRaw.includes(key)) return code;
  }
  return 'ETC';
}

/** supplierRaw → land_operators 테이블 ID (DB 우선, 없으면 null) */
function resolveLandOperatorId(
  supplierRaw: string | undefined,
  ops: Array<{ id: string; name: string }>,
): string | null {
  if (!supplierRaw || !ops.length) return null;
  return ops.find(op =>
    supplierRaw.includes(op.name) || op.name.includes(supplierRaw)
  )?.id ?? null;
}

/**
 * 3중 필터 랜드사 식별 엔진 (파일명에 랜드사 정보 없을 때 호출)
 *
 * Phase 1 — Deterministic: 추출 텍스트에서 DB 랜드사명 정규식 스캔 (무비용)
 * Phase 2 — RAG Flywheel: ai_training_logs 과거 학습 조회 (DB 1회)
 * Phase 3 — LLM Inference: Gemini Flash 헤더+푸터 추론 (~500 토큰)
 */
async function identifySupplierFromText(
  extractedText: string,
  ops: Array<{ id: string; name: string }>,
): Promise<SupplierIdentificationResult> {
  const UNKNOWN: SupplierIdentificationResult = {
    supplierRaw: null, supplierCode: 'ETC', landOperatorId: null,
    identificationSource: 'unknown',
  };
  if (!extractedText || !ops.length) return UNKNOWN;

  // ── Phase 1: Deterministic — 텍스트에서 랜드사명 정규식 스캔 ───────────────
  const lower = extractedText.toLowerCase();
  for (const op of ops) {
    if (lower.includes(op.name.toLowerCase())) {
      console.log('[identifySupplier] Phase1 text_regex 매칭:', op.name);
      return {
        supplierRaw: op.name,
        supplierCode: resolveSupplierCode(op.name),
        landOperatorId: op.id,
        identificationSource: 'text_regex',
      };
    }
  }

  // ── Phase 2: RAG Flywheel — ai_training_logs 과거 학습 조회 ─────────────────
  try {
    const fingerprint = createHash('sha256')
      .update(extractedText.slice(0, 500))
      .digest('hex');

    const { data: log } = await supabaseAdmin
      .from('ai_training_logs')
      .select('human_corrected_json, correction_diff')
      .filter("ai_parsed_json->>'text_fingerprint'", 'eq', fingerprint)
      .not('correction_diff', 'is', null)
      .limit(1)
      .maybeSingle();

    if (log) {
      const diff = (log as any).correction_diff as Record<string, { from: string; to: string }> | null;
      const corrected = (log as any).human_corrected_json as Record<string, string> | null;
      const toCode     = diff?.supplier_code?.to;
      const supplierName = corrected?.supplier_name ?? null;
      const landOpId     = corrected?.land_operator_id ?? null;
      if (toCode && toCode !== 'ETC' && supplierName && landOpId) {
        console.log('[identifySupplier] Phase2 rag_flywheel 히트:', supplierName);
        return {
          supplierRaw: supplierName,
          supplierCode: toCode,
          landOperatorId: landOpId,
          identificationSource: 'rag_flywheel',
        };
      }
    }
  } catch (e) {
    console.warn('[identifySupplier] Phase2 RAG 실패 (비중단):', e);
  }

  // ── Phase 3: LLM Inference — Gemini Flash 헤더+푸터 추론 ────────────────────
  try {
    const apiKey = getSecret('GOOGLE_AI_API_KEY') || getSecret('GOOGLE_GEMINI_API_KEY') || getSecret('GOOGLE_API_KEY') || '';
    if (!apiKey) return UNKNOWN;

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const snippet = `${extractedText.slice(0, 400)}\n...\n${extractedText.slice(-300)}`;
    const prompt = `다음 여행 문서의 헤더와 푸터를 보고 랜드사(현지여행사) 이름을 찾으세요.\nJSON만 반환: {"supplier_name": "이름 또는 null"}\n\n${snippet}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return UNKNOWN;

    const inferred: string | null = JSON.parse(match[0])?.supplier_name ?? null;
    if (!inferred || inferred === 'null') return UNKNOWN;

    const found = ops.find(op =>
      inferred.toLowerCase().includes(op.name.toLowerCase()) ||
      op.name.toLowerCase().includes(inferred.toLowerCase())
    );
    if (found) {
      console.log('[identifySupplier] Phase3 llm_inference 성공:', found.name);
      return {
        supplierRaw: found.name,
        supplierCode: resolveSupplierCode(found.name),
        landOperatorId: found.id,
        identificationSource: 'llm_inference',
      };
    }
  } catch (e) {
    console.warn('[identifySupplier] Phase3 LLM 실패 (비중단):', e);
  }

  return UNKNOWN;
}

/** 출발지 텍스트 → departing_locations 테이블 ID (DB 우선, 없으면 null) */
function resolveDepartingLocationId(
  departureText: string | undefined,
  locs: Array<{ id: string; name: string }>,
): string | null {
  if (!departureText || !locs.length) return null;
  return locs.find(loc =>
    departureText.includes(loc.name) || loc.name.includes(departureText)
  )?.id ?? null;
}

/**
 * 한국어 지역명에서 IATA 코드 추출
 * 매핑 키를 순회하여 텍스트 내 포함 여부로 fallback 처리
 */
function resolveCode(text: string | undefined, map: Record<string, string>, fallback: string): string {
  if (!text) return fallback;
  // 정확한 키 매칭
  if (map[text]) return map[text];
  // 부분 포함 매칭
  for (const [key, code] of Object.entries(map)) {
    if (text.includes(key)) return code;
  }
  return fallback;
}

/**
 * Supabase RPC로 internal_code 자동 생성
 * generate_internal_code(PUS, TP, OSA, 5) → 'PUS-TP-OSA-05-0001'
 */
async function generateInternalCode(
  departureCode: string,
  supplierCode: string,
  destinationCode: string,
  durationDays: number,
): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('generate_internal_code', {
    p_departure_code:   departureCode,
    p_supplier_code:    supplierCode,
    p_destination_code: destinationCode,
    p_duration_days:    durationDays,
  });
  if (error) throw new Error(`internal_code 생성 실패: ${error.message}`);
  if (!data) throw new Error('internal_code RPC가 null을 반환했습니다.');
  return data as string;
}

// ─── 파일명 기반 목적지 임시 추출 (Reflexion + 지역캐시 사전 조회용) ──────────────

const DEST_KEYWORDS = [
  '장가계', '장자제', '서안', '시안', '북경', '상해', '청두', '계림', '황산', '연길', '중경',
  '방콕', '치앙마이', '싱가포르', '다낭', '하노이', '호치민', '나트랑', '푸꾸옥', '세부', '마닐라',
  '발리', '쿠알라룸푸르', '양곤', '오사카', '도쿄', '후쿠오카', '삿포로', '오키나와',
  '홍콩', '마카오', '대만', '타이페이', '괌', '사이판',
];

/**
 * 본문 텍스트에서 가장 빈도 높은 목적지 키워드를 추출 (DEST_CODE_MAP 매칭, 등장 횟수 기반).
 * DeepSeek/Gemini 가 destination 을 빼먹은 케이스 회복용 fallback — 2026-05-14 박제.
 * 본문 시작 3000자만 스캔 (랜드사 헤더·일정표 영역 위주). 출발지 표현(부산/김해 등)은 제외.
 */
const DEST_FALLBACK_SKIP = new Set([
  '부산', '인천', '김포', '제주', '청주', '대구',
]);
function inferDestinationFromText(rawText: string | undefined): string {
  if (!rawText) return '';
  const head = rawText.slice(0, 3000);
  const counts: Record<string, number> = {};
  for (const name of Object.keys(DEST_CODE_MAP)) {
    if (DEST_FALLBACK_SKIP.has(name)) continue;
    if (name.length < 2) continue;
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const m = head.match(re);
    if (m && m.length > 0) counts[name] = m.length;
  }
  let best = '';
  let bestCount = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return bestCount >= 1 ? best : '';
}

function extractDestinationFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  for (const kw of DEST_KEYWORDS) {
    if (base.includes(kw)) return kw;
  }
  return '';
}

// ─── API Route ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    console.log('[Upload API] 요청 시작:', new Date().toISOString());

    if (!isSupabaseConfigured) {
      console.warn('[Upload API] Supabase 환경변수 미설정 — DB 저장 비활성화');
    }

    // ── [A] 입력 검증 (파일 또는 텍스트) ──────────────────────────────────────

    const contentType = request.headers.get('content-type') || '';
    let file: File | null = null;
    let directRawText: string | null = null;

    if (contentType.includes('application/json')) {
      // 텍스트 직접 붙여넣기 모드
      const body = await request.json();
      directRawText = body.rawText;
      if (!directRawText || directRawText.trim().length < 50) {
        return NextResponse.json({ error: '텍스트가 너무 짧습니다. 최소 50자 이상 입력하세요.' }, { status: 400 });
      }
      console.log('[Upload API] 텍스트 모드:', directRawText.length, '자');
    } else {
      // 기존 파일 업로드 모드
      const formData = await request.formData();
      file = formData.get('file') as File;

      if (!file) {
        return NextResponse.json({ error: '파일이 업로드되지 않았습니다.' }, { status: 400 });
      }
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: '파일 크기는 10MB 이하여야 합니다.' }, { status: 400 });
      }
    }

    // ── 텍스트 모드 분기: 파일 검증/해시 건너뛰고 바로 파싱 ─────────────────
    const urlParams = new URL(request.url).searchParams;
    const archiveMode = !directRawText && urlParams.get('mode') === 'archive';
    const bulkMode = urlParams.get('mode') === 'bulk';
    if (archiveMode) console.log('[Upload API] 아카이브 모드 — AI 파싱 스킵');
    if (bulkMode) console.log('[Upload API] 벌크 모드 — 분류/마케팅/attractions 스킵');

    let buffer: Buffer;
    let fileHash: string;
    const fileName = file?.name || '텍스트입력.txt';

    if (directRawText) {
      // 텍스트 모드: 텍스트 자체를 buffer/hash로 변환
      buffer = Buffer.from(directRawText, 'utf-8');
      fileHash = createHash('sha256').update(buffer).digest('hex');
      console.log('[Upload API] 텍스트 모드 해시:', fileHash.slice(0, 12));
    } else {
      // 파일 모드: 기존 로직
      const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.hwpx'];
      const ext = '.' + (file!.name.split('.').pop()?.toLowerCase() ?? '');
      if (!allowedExtensions.includes(ext)) {
        return NextResponse.json(
          { error: `지원하지 않는 파일 형식입니다. (${allowedExtensions.join(', ')})` },
          { status: 400 },
        );
      }
      console.log('[Upload API] 파일 정보:', { name: file!.name, size: file!.size });
      buffer = Buffer.from(await file!.arrayBuffer());
      fileHash = createHash('sha256').update(buffer).digest('hex');
    }

    // ── [B] SHA-256 해시 계산 + 중복 파일 차단 ───────────────────────────────

    // 2026-05-15 박제: 강제 재처리 옵션 — UI 에서 ?force=1 또는 ?reprocess=1 query.
    //   사장님이 같은 텍스트를 의도적으로 다시 처리하고 싶을 때 (archived 정리 후 재시도 등).
    const forceReprocess = urlParams.get('force') === '1' || urlParams.get('reprocess') === '1';

    if (isSupabaseConfigured && !forceReprocess) {
      const { data: existingHashes } = await supabaseAdmin
        .from('document_hashes')
        .select('file_hash, product_id, file_name')
        .eq('file_hash', fileHash);

      // 2026-05-15 박제: archived/inactive product 의 hash 는 차단 해제 (재처리 허용).
      //   사장님이 잘못 등록된 상품을 archived 시킨 후 새 코드로 재시도하려는 의도 보호.
      let blocked: { file_hash: string; product_id: string | null; file_name: string } | null = null;
      if (existingHashes && existingHashes.length > 0) {
        const productIds = (existingHashes as Array<{ product_id: string | null }>)
          .map(h => h.product_id)
          .filter((p): p is string => !!p);
        if (productIds.length > 0) {
          const { data: aliveProducts } = await supabaseAdmin
            .from('products')
            .select('internal_code, status')
            .in('internal_code', productIds)
            .not('status', 'in', '("archived","inactive","deleted")');
          const aliveSet = new Set((aliveProducts ?? []).map((p: { internal_code: string }) => p.internal_code));
          blocked = (existingHashes as Array<{ file_hash: string; product_id: string | null; file_name: string }>)
            .find(h => h.product_id && aliveSet.has(h.product_id)) ?? null;
        }
      }

      if (blocked) {
        console.log('[Upload API] 중복 파일 감지 — 파싱 스킵:', fileHash.slice(0, 12),
          `(기존 product ${blocked.product_id} alive)`);
        return NextResponse.json({
          success:       true,
          duplicate:     true,
          fileHash,
          internal_code: blocked.product_id,
          message:       `이미 처리된 파일입니다. (원본: ${blocked.file_name}) 재처리하려면 force=1.`,
          hint:          'archived 된 상품은 자동으로 재처리 허용됩니다.',
        });
      }

      // 텍스트 붙여넣기: 띄어쓰기·개행만 다른 동일 카탈로그 사전 차단 (파싱 전)
      if (directRawText) {
        const normalizedContentHash = computeNormalizedContentHash(directRawText);
        const { data: existingNormRows } = await supabaseAdmin
          .from('document_hashes')
          .select('file_hash, product_id, file_name, normalized_hash')
          .eq('normalized_hash', normalizedContentHash);

        // 동일하게 alive product 만 차단
        let blockedNorm: { file_hash: string; product_id: string | null; file_name: string; normalized_hash: string } | null = null;
        if (existingNormRows && existingNormRows.length > 0) {
          const normPids = (existingNormRows as Array<{ product_id: string | null }>)
            .map(h => h.product_id)
            .filter((p): p is string => !!p);
          if (normPids.length > 0) {
            const { data: aliveNorm } = await supabaseAdmin
              .from('products')
              .select('internal_code, status')
              .in('internal_code', normPids)
              .not('status', 'in', '("archived","inactive","deleted")');
            const aliveNormSet = new Set((aliveNorm ?? []).map((p: { internal_code: string }) => p.internal_code));
            blockedNorm = (existingNormRows as Array<{ file_hash: string; product_id: string | null; file_name: string; normalized_hash: string }>)
              .find(h => h.product_id && aliveNormSet.has(h.product_id)) ?? null;
          }
        }

        if (blockedNorm) {
          console.log('[Upload API] 정규화 해시 중복 — 파싱 스킵:', normalizedContentHash.slice(0, 12));
          return NextResponse.json({
            success:               true,
            duplicate:             true,
            duplicateReason:       'normalized_content',
            fileHash,
            normalizedContentHash: normalizedContentHash.slice(0, 16) + '…',
            internal_code:         blockedNorm.product_id,
            message:               `이미 처리된 카탈로그입니다(본문 정규화 기준). 원본: ${blockedNorm.file_name}. 재처리하려면 force=1.`,
          });
        }
      }
    } else if (forceReprocess) {
      console.log('[Upload API] force=1 — 중복 차단 우회');
    }

    // ── [C] 마스터 데이터 병렬 로드 (land_operators + departing_locations) ──

    const [{ data: landOps }, { data: depLocs }] = await Promise.all([
      supabaseAdmin.from('land_operators').select('id, name').eq('is_active', true),
      supabaseAdmin.from('departing_locations').select('id, name').eq('is_active', true),
    ]);

    // ── [D] 파일명 파싱 ──────────────────────────────────────────────────────

    const filenameRule = parseFilename(fileName);
    const supplierCode = resolveSupplierCode(filenameRule.supplierRaw);
    const marginRate   = filenameRule.marginRate ?? 0.10;

    console.log('[Upload API] 파일명 파싱:', { filenameRule, supplierCode, marginRate });

    // ── [아카이브] AI 전체 스킵 — 텍스트만 저장 후 early return ─────────────
    if (archiveMode) {
      let rawText = '';
      try {
        rawText = buffer.toString('utf-8').slice(0, 50000);
      } catch { /* 이진 파일은 빈 문자열 */ }

      // 정규식으로 날짜 추출 (AI 없이)
      const dateMatch = rawText.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
      const departureDateStr = dateMatch
        ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
        : null;
      const isExpired = departureDateStr ? new Date(departureDateStr) < new Date() : false;
      const archiveStatus = isExpired ? 'expired' : 'DRAFT';

      // 임시 SKU (파일명 기반 단순화)
      const archiveSku = `ARCH-${filenameRule.cleanName.slice(0, 20).replace(/\s/g, '-')}-${Date.now()}`;

      const archiveSupplierCode     = resolveSupplierCode(filenameRule.supplierRaw);
      const archiveLandOperatorId   = resolveLandOperatorId(filenameRule.supplierRaw, landOps ?? []);

      if (isSupabaseConfigured) {
        // ignoreDuplicates: true — 같은 SKU 2번 올려도 기존 데이터 보존
        await supabaseAdmin.from('products').upsert({
          internal_code:      archiveSku,
          display_name:       filenameRule.cleanName ?? fileName,
          status:             archiveStatus,
          source_filename:    fileName,
          raw_extracted_text: rawText,
          departure_date:     departureDateStr,
          supplier_code:      archiveSupplierCode,
          land_operator_id:   archiveLandOperatorId,
          created_at:         new Date().toISOString(),
          updated_at:         new Date().toISOString(),
        }, { onConflict: 'internal_code', ignoreDuplicates: true });
      }

      console.log(`[Upload API] 아카이브 저장 완료: ${archiveSku} → ${archiveStatus}`);
      return NextResponse.json({
        success: true,
        mode:    'archive',
        sku:     archiveSku,
        status:  archiveStatus,
        expired: isExpired,
        message: isExpired
          ? `아카이브 완료 (만료: ${departureDateStr})`
          : `아카이브 완료 (초안 저장)`,
      });
    }

    // ── [E] Step 1: 문서 분류 (저비용 사전 분류) ─────────────────────────────
    // 첫 2,000자만 사용하는 경량 Gemini 호출로 상품 개수·문서 유형·여행 여부 파악

    // ── [E-0] Reflexion + 지역 컨텍스트 사전 조회 (파싱 품질 향상) ─────────────
    // 파일명에서 목적지를 임시 추출해 과거 정정 사례 + 지역 블록 데이터를 병렬 조회.
    // DeepSeek prefix 캐싱: EXTRACT_PROMPT + regionContext 부분이 자동 캐시됨.
    const tempDest = extractDestinationFromFilename(fileName);
    // 파일명 기반 랜드사 ID (parseDocument 전에 computeable한 예비값)
    const prelimLandOperatorId = resolveLandOperatorId(filenameRule.supplierRaw, landOps ?? []);
    let parseOptions: ParseOptions = {};
    if (isSupabaseConfigured) {
      const [reflections, regionContext, landOperatorProfile] = await Promise.all([
        getRelevantReflections(supabaseAdmin, {
          destination: tempDest || undefined,
          landOperatorId: prelimLandOperatorId || undefined,
          minSeverity: 'medium',
          limit: 5,
        }).catch(() => []),
        tempDest ? getRegionCacheContext(tempDest).catch(() => '') : Promise.resolve(''),
        prelimLandOperatorId ? getLandOperatorProfile(prelimLandOperatorId).catch(() => null) : Promise.resolve(null),
      ]);
      if (reflections.length > 0) {
        console.log('[Upload API] Reflexion 주입:', reflections.length, '건 (목적지:', tempDest, ')');
      }
      if (regionContext) {
        console.log('[Upload API] 지역 컨텍스트 로드:', tempDest, regionContext.length, '자');
      }
      if (landOperatorProfile) {
        console.log('[Upload API] 랜드사 프로파일 로드:', landOperatorProfile.total_registrations, '등록 누적, avg conf:', landOperatorProfile.avg_confidence);
      }
      parseOptions = { reflections, regionContext, landOperatorProfile: landOperatorProfile ?? undefined };
    }

    // ── [E-1] PDF/HWP 텍스트 추출 (바이너리 → 텍스트) ──────────────────────
    // 중요: PDF는 바이너리이므로 buffer.toString('utf-8')은 깨진 문자열을 반환함
    // 반드시 pdf-parse로 먼저 텍스트를 추출한 후 분류기에 넘겨야 함
    const parsedDocument = await parseDocument(buffer, fileName, parseOptions);
    const rawTextForClassify = (parsedDocument.rawText || '').slice(0, 3000);
    const normalizedCatalogHash = computeNormalizedContentHash(parsedDocument.rawText ?? '');

    // 파일 업로드: 추출된 본문 기준 정규화 해시 중복 (PDF/HWP 등 — 파싱 후 검사)
    if (isSupabaseConfigured && !directRawText && (parsedDocument.rawText ?? '').trim().length >= 50) {
      const { data: existingNormFile } = await supabaseAdmin
        .from('document_hashes')
        .select('file_hash, product_id, file_name, normalized_hash')
        .eq('normalized_hash', normalizedCatalogHash)
        .maybeSingle();

      if (existingNormFile) {
        console.log('[Upload API] 파일 모드 정규화 해시 중복 — 저장 스킵:', normalizedCatalogHash.slice(0, 12));
        return NextResponse.json({
          success:               true,
          duplicate:             true,
          duplicateReason:       'normalized_content',
          fileHash,
          normalizedContentHash: normalizedCatalogHash.slice(0, 16) + '…',
          internal_code:         existingNormFile.product_id ?? null,
          message:               `이미 처리된 카탈로그입니다(추출 본문 정규화 기준). 원본: ${existingNormFile.file_name}`,
        });
      }
    }

    // 분류 항상 스킵 (여행상품만 올리므로 불필요 — 토큰 절약)
    const classification = { productCount: 1, isTravel: true, documentType: 'package' as const, estimatedConfidence: 0.9 };
    console.log('[Upload API] Step1 분류: 스킵 (토큰 절약)');

    // ── [F] Step 2: 파싱 결과 활용 (이미 위에서 완료) ────────────────────────

    console.log('[Upload API] Step2 파싱 완료:', {
      title:      parsedDocument.extractedData.title,
      confidence: parsedDocument.confidence,
      multiCount: parsedDocument.multiProducts?.length ?? 1,
    });

    // ── 마스터 DB ID 매핑 ────────────────────────────────────────────────────

    // 파일명 기반 1차 해석 — supplierRaw 없으면 3중 필터로 보강
    let effectiveSupplierCode   = supplierCode;
    let effectiveLandOperatorId = resolveLandOperatorId(filenameRule.supplierRaw, landOps ?? []);

    if (!filenameRule.supplierRaw) {
      const identified = await identifySupplierFromText(parsedDocument.rawText, landOps ?? []);
      effectiveSupplierCode   = identified.supplierCode;
      effectiveLandOperatorId = identified.landOperatorId;
      console.log('[Upload API] 텍스트 기반 랜드사 식별:', identified.identificationSource, effectiveSupplierCode);
    }

    const departingLocationId = resolveDepartingLocationId(
      parsedDocument.extractedData.departure_airport ?? filenameRule.cleanName,
      depLocs ?? [],
    );
    console.log('[Upload API] 마스터 매핑:', {
      supplierRaw: filenameRule.supplierRaw, effectiveSupplierCode, effectiveLandOperatorId,
      departure: parsedDocument.extractedData.departure_airport, departingLocationId,
    });

    // ── [G] 각 상품별 내부코드 생성 + 이중 저장 루프 ────────────────────────

    const productsToSave = parsedDocument.multiProducts ?? [
      { extractedData: parsedDocument.extractedData, itineraryData: parsedDocument.itineraryData ?? null },
    ];

    const savedIds: string[]           = [];
    const savedTitles: string[]        = [];
    const savedInternalCodes: string[] = [];
    const saveErrors: { title: string; error: string }[] = [];
    let   totalPriceRowsSaved = 0;
    const unmatchedRowsToInsert: {
      activity: string;
      package_id: string;
      package_title: string;
      day_number: number;
      country: string | null;
    }[] = [];
    const matchedCanonicalNames = new Set<string>();
    const extractedCandidateRows: { activity: string; destination?: string }[] = [];
    // A2/A3 박제 (2026-05-15): 등록 종료 후 사장님에게 한 화면 보고용 통계.
    //   ERR-XIY-2026-05-16 STRICT SSOT 전환 후 자동 시드 없음 → 항상 0 (응답 호환성 유지).
    const attractionSeededCount = 0;
    const attractionReflectedCount = 0;

    let activeAttractions: AttractionData[] = [];
    if (isSupabaseConfigured && !bulkMode) {
      const { data: attrRows } = await supabaseAdmin
        .from('attractions')
        .select('id, name, short_desc, long_desc, aliases, country, region, category, emoji')
        .eq('is_active', true);
      activeAttractions = (attrRows || []) as AttractionData[];
    }

    for (const product of productsToSave) {
      const ed = product.extractedData;
      const title = ed.title || filenameRule.cleanName || fileName;

      // 보상 트랜잭션을 위한 상태 추적
      let internalCode: string | null = null;
      let productInserted = false;

      try {
        // ── G1. 코드 유도 ────────────────────────────────────────────────────

        const departureRaw    = ed.departure_airport ?? '부산';
        const departureCode   = resolveCode(departureRaw, REGION_CODE_MAP, 'PUS');
        const destinationCode = resolveCode(ed.destination, DEST_CODE_MAP, 'UNK');
        const durationDays    = ed.duration ?? 5;
        const departureRegion =
          Object.entries(REGION_CODE_MAP).find(([, code]) => code === departureCode)?.[0]
          ?? departureRaw.split('(')[0].trim();

        console.log(`[Upload API] 코드 유도: ${departureCode}-${effectiveSupplierCode}-${destinationCode}-${durationDays}일`);

        // ── G2. RPC → internal_code ──────────────────────────────────────────

        if (isSupabaseConfigured) {
          internalCode = await generateInternalCode(departureCode, effectiveSupplierCode, destinationCode, durationDays);
          console.log('[Upload API] internal_code 발급:', internalCode);
        }

        // ── G3. Zod 검증 + 가격 행 변환 ──────────────────────────────────────
        applyDeterministicExtractedDataFixes(ed);

        // destination 미추출 회복 — 본문 키워드 빈도 매칭 (2026-05-14 박제, 부관훼리 회귀)
        if (!ed.destination || !ed.destination.trim()) {
          const inferred = inferDestinationFromText(parsedDocument.rawText)
            || tempDest
            || '';
          if (inferred) {
            ed.destination = inferred;
            console.log(`[Upload API] destination 본문 fallback 적용: "${inferred}" (LLM 미추출 → 키워드 빈도 매칭)`);
          }
        }

        // ── Hybrid v2 Stage 1: Deterministic Layer (2026-05-14 박제) ────────────
        //   LLM 이 못 잡거나 잘못 잡은 결정적 필드를 정규식으로 회복. 빈 필드만 채움 (기존값 보존).
        //   부관훼리·베트남 같은 ferry/카탈로그 케이스에서 핵심 효과.
        const rawForDeterm = parsedDocument.rawText ?? '';

        // 1) Ferry/Cruise 자동 분류 — title/본문 키워드 매칭. 이미 LLM 이 'cruise' 잡으면 그대로.
        const ferry = detectFerry(rawForDeterm, ed.title);
        if (ferry.isFerry) {
          if (!ed.product_type || ed.product_type === 'package') {
            ed.product_type = 'cruise';
          }
          if (!ed.airline && ferry.ferryName) {
            ed.airline = ferry.ferryName;
          }
          console.log(`[Upload API] Ferry 결정적 분류: ${ferry.matchedKeyword} → product_type=cruise, airline=${ferry.ferryName ?? 'kept'}`);
        }

        // 2) 월·요일별 가격표 결정적 추출 — LLM 이 price_tiers 0 건이면 정규식으로 채움.
        const llmPriceTiers = Array.isArray(ed.price_tiers) ? ed.price_tiers.length : 0;
        if (llmPriceTiers === 0) {
          const detTiers = extractPriceTable(rawForDeterm);
          if (detTiers.length > 0) {
            ed.price_tiers = detTiers as typeof ed.price_tiers;
            // 최저가도 함께 보정
            const lowest = detTiers
              .map(t => t.adult_price)
              .filter((p): p is number => typeof p === 'number' && p > 0);
            if (lowest.length > 0 && (!ed.price || ed.price === 0)) {
              ed.price = Math.min(...lowest);
            }
            console.log(`[Upload API] price_tiers 결정적 추출: ${detTiers.length} 행, 최저가 ${ed.price?.toLocaleString?.() ?? '?'} (LLM 0건 회복)`);
          }
        }

        // 3) ▶ 불릿 inclusions/excludes 결정적 추출 — LLM 0건이면 정규식으로 채움.
        const bullets = extractBullets(rawForDeterm);
        if ((!ed.inclusions || ed.inclusions.length === 0) && bullets.inclusions.length > 0) {
          ed.inclusions = bullets.inclusions;
          console.log(`[Upload API] inclusions 결정적 추출: ${bullets.inclusions.length} 건`);
        }
        if ((!ed.excludes || ed.excludes.length === 0) && bullets.excludes.length > 0) {
          ed.excludes = bullets.excludes;
          console.log(`[Upload API] excludes 결정적 추출: ${bullets.excludes.length} 건`);
        }

        // 4) notices_parsed 4-type 결정적 분류 — Cross-validation 룰 C3 통과 핵심.
        //    LLM 이 4 타입 분류를 자주 빼먹어 confidence 점수 하락 원인이 됨.
        const detNotices = extractNotices(rawForDeterm);
        const llmNoticesRaw: unknown[] = Array.isArray(ed.notices_parsed) ? ed.notices_parsed : [];
        // type narrowing: notices_parsed 가 string|NoticeItem union 이라 object 만 추출
        const llmNoticeTypes = new Set<string>();
        for (const n of llmNoticesRaw) {
          if (n && typeof n === 'object' && 'type' in n) {
            const t = (n as { type?: unknown }).type;
            if (typeof t === 'string') llmNoticeTypes.add(t);
          }
        }
        let appended = 0;
        const additional: typeof detNotices = [];
        for (const dn of detNotices) {
          if (llmNoticeTypes.has(dn.type)) continue;
          additional.push(dn);
          llmNoticeTypes.add(dn.type);
          appended++;
        }
        if (appended > 0) {
          ed.notices_parsed = [...llmNoticesRaw, ...additional] as typeof ed.notices_parsed;
          console.log(`[Upload API] notices_parsed 결정적 보완: +${appended} type (전체 ${(ed.notices_parsed as unknown[]).length}/4)`);
        }

        // 5) Critic Agent — cross-field consistency 결정적 검증 (DocSync 2605.02163 패턴, 2026-05-14).
        //    title↔destination, ferry↔airline, days↔nights, price-range 자동 검증 + 자동 수정 가능 항목 적용.
        const criticIssues = detectCriticIssues({
          title: ed.title,
          destination: ed.destination,
          airline: ed.airline,
          product_type: ed.product_type,
          duration: ed.duration,
          nights: (ed as { nights?: number }).nights ?? null,
          price: ed.price ?? null,
          departure_airport: ed.departure_airport,
          rawText: rawForDeterm,
        });
        if (criticIssues.length > 0) {
          console.warn(`[Upload API] Critic ${criticIssues.length} issue(s):`,
            criticIssues.map(i => `${i.severity}/${i.rule}`).join(' | '));
          const { fixed } = autoFixCriticIssues(ed as unknown as Record<string, unknown>, criticIssues);
          if (fixed.length > 0) {
            console.log(`[Upload API] Critic 자동 수정 ${fixed.length}건: ${fixed.join(', ')}`);
          }
        }

        // 6) Section-Aware Classifier — 사장님 비전 V5: 원문 섹션 위치가 분류 SSOT (2026-05-14)
        //    같은 "마사지 120분" 도 어느 섹션에 등장했는지가 perk/inclusion/optional 결정 SSOT.
        //    inclusions / excludes / optional 의 각 항목을 섹션 컨텍스트로 재검증 + signals 누적.
        try {
          const sectionResult = parseSections(rawForDeterm);
          const recordOne = async (text: string, defaultCategory: 'inclusion' | 'optional' | 'exclude' | 'perk') => {
            if (!text || text.length < 2 || text.length > 200) return;
            // 2026-05-15 INT-4: 우선 signals DB 에서 이전 분류 lookup (compound learning).
            //   이전에 사장님 정정 또는 자동 학습된 결과가 있으면 그것을 follow.
            const prior = await lookupSignal(text, ed.destination ?? null).catch(() => null);
            const offset = rawForDeterm.indexOf(text);
            const ctx = offset >= 0 ? sectionResult.classifyOffset(offset) : 'unknown';
            const final = classifyByContext(text, ctx);
            const chosen = prior?.category ?? (final.category === 'unknown' ? defaultCategory : final.category);
            // signals 누적 (fire-and-forget) — 다음 등록부터 instant
            void recordSignal({
              keyword: text,
              category: chosen,
              destination: ed.destination ?? null,
              product_type: ed.product_type ?? null,
              source: prior ? prior.source : 'local',
              confidence: prior ? (prior.confidence + final.confidence) / 2 : final.confidence,
            });
          };
          for (const inc of ed.inclusions ?? []) void recordOne(inc, 'inclusion');
          for (const exc of ed.excludes ?? []) void recordOne(exc, 'exclude');
          for (const opt of ed.optional_tours ?? []) {
            const name = (opt as { name?: string })?.name;
            if (name) void recordOne(name, 'optional');
          }
          console.log(`[Upload API] Section-Aware signals 누적: inc ${ed.inclusions?.length ?? 0} + exc ${ed.excludes?.length ?? 0} + opt ${ed.optional_tours?.length ?? 0}`);
        } catch (e) {
          console.warn('[Upload API] section-aware 누적 실패 (무시):', (e as Error).message);
        }

        // 7) Recommendation Copy 자동 생성 — product_summary 무의미하면 결정적 카피로 교체 (UX-5)
        if (isWeakCopy(ed.product_summary, ed.title)) {
          const auto = generateRecommendationCopy({
            title: ed.title,
            destination: ed.destination,
            duration: ed.duration,
            departure: (ed as { departure?: string }).departure ?? null,
            product_type: ed.product_type,
            inclusions: ed.inclusions,
            product_highlights: ed.product_highlights,
            airline: ed.airline,
          });
          if (auto.length > (ed.product_summary?.length ?? 0)) {
            console.log(`[Upload API] product_summary 자동 재생성: "${auto}"`);
            ed.product_summary = auto;
          }
        }

        let validation = validateExtractedProduct(ed);
        if (validation.warnings.length > 0) {
          console.warn('[Upload API] 검증 경고:', validation.warnings.join(' | '));
        }
        if (!validation.isValid) {
          console.warn('[Upload API] Zod 검증 실패:', validation.errors.join(' | '));
          const repaired = await repairExtractedDataWithGemini(
            ed,
            validation.errors,
            parsedDocument.rawText ?? '',
          );
          if (repaired) {
            applyDeterministicExtractedDataFixes(ed);
            validation = validateExtractedProduct(ed);
            if (validation.isValid) {
              console.log('[Upload API] Zod Gemini 필드 보정으로 검증 통과');
            } else {
              console.warn('[Upload API] Zod 보정 후에도 실패:', validation.errors.join(' | '));
            }
          }
        }

        // net_price CHECK (net_price > 0) 제약조건 방어
        // AI가 가격을 파싱 못했으면 price_tiers에서 최저가 추출, 그래도 없으면 1
        let netPrice = ed.price ?? 0;
        if (netPrice <= 0 && ed.price_tiers?.length) {
          const prices = ed.price_tiers
            .map(t => t.adult_price)
            .filter((p): p is number => typeof p === 'number' && p > 0);
          if (prices.length > 0) netPrice = Math.min(...prices);
        }
        if (netPrice <= 0) netPrice = 1; // 최소 1원 — DB CHECK 통과, 상품관리에서 수동 수정

        // ── G2.5. Customer-Leak Sanitizer (1차 게이트) — 2026-05-13 박제 ──
        // 추출 데이터 전체를 통과시켜 운영/커미션/내부 메모 제거.
        // 결과 incidents → 신뢰도 V2 의 leak penalty 입력.
        const sanitizeResult = sanitizeForCustomer(ed);
        if (sanitizeResult.incidents.length > 0) {
          console.warn(`[Upload API] Customer-Leak ${sanitizeResult.incidents.length}건 (score=${sanitizeResult.leakScore.toFixed(2)}):`,
            sanitizeResult.incidents.map(i => `${i.severity}/${i.patternId}@${i.field}`).join(' | '));
        }
        Object.assign(ed, sanitizeResult.cleaned); // in-place 적용 — 이후 INSERT 에 자동 반영

        // ── G3. 신뢰도 V2 (채움률 30% + 정합성 40% + 누출안전 30%) ──
        // F-4 박제: 정책 임계치 동적 로드 (DB registration_auto_policy)
        const autoGatePolicy = await getRegistrationPolicy();
        const v2 = calculateConfidenceV2(ed, {
          leakScore: sanitizeResult.leakScore,
          itineraryData: product.itineraryData as unknown as { days?: Array<{ schedule?: Array<{ type?: string }>; hotel?: { name?: string | null } }>; meta?: { airline?: string | null; flight_out?: string | null; flight_in?: string | null } } | undefined,
          policy: autoGatePolicy,
        });
        const confidence = v2.confidence;
        console.log(`[Upload API] confidence V2: ${(v2.confidence*100).toFixed(1)}% (fill=${(v2.fillScore*100).toFixed(0)}% xvalid=${(v2.crossValidationScore*100).toFixed(0)}% clean=${(v2.cleanScore*100).toFixed(0)}%) autoGate=${v2.autoGate}`);
        const failedChecks = v2.checks.filter(c => !c.passed);
        if (failedChecks.length > 0) {
          console.warn(`[Upload API] Cross-validation 실패 ${failedChecks.length}건:`, failedChecks.map(c => `${c.severity}/${c.id}: ${c.message}`).join(' | '));
          // Reflexion 자동 누적 — 다음 등록 시 같은 랜드사·지역 prompt 에 주입
          if (isSupabaseConfigured) {
            const v2Rows = failedChecks.map(c => ({
              field_path:       `v2.${c.id}`,
              reflection:       `V2 cross-validation 실패 [${c.severity}]: ${c.message}`,
              before_value:     null,
              after_value:      null,
              raw_text_excerpt: (parsedDocument.rawText ?? '').slice(0, 500),
              severity:         c.severity,
              category:         'v2_cross_validation_failure',
              land_operator_id: effectiveLandOperatorId,
              destination:      ed.destination ?? tempDest ?? null,
              is_active:        true,
              applied_count:    0,
            }));
            void supabaseAdmin.from('extractions_corrections').insert(v2Rows)
              .then(({ error }: { error: { message: string } | null }) => {
                if (error) console.warn('[Upload API] V2 reflexion 적재 실패(무시):', error.message);
              });
          }
        }

        const priceRows  = priceTiersToRows(ed);

        console.log(`[Upload API] 가격 행 ${priceRows.length}개 변환됨 (product_prices)`);

        // ── G3-B. 4단계 업로드 게이트 분류 ───────────────────────────────────

        const uploadGate: UploadGate = classifyUploadGate(validation, confidence, priceRows.length);
        console.log(`[Upload API] 업로드 게이트: ${uploadGate} (confidence=${(confidence * 100).toFixed(0)}%, priceRows=${priceRows.length})`);

        // BLOCKED: 핵심 필드 누락 → 학습 로그 + 검토 큐 기록 후 INSERT 강행 (status=REVIEW_NEEDED)
        // 2026-05-14 박제: INSERT 자체를 건너뛰면 사장님 어드민 상품관리에서 보이지 않아
        // "방어막을 강화할수록 워크플로우가 끊기는" 안티패턴 (사장님 부관훼리 케이스).
        // → INSERT 는 진행하되 determineProductStatus 가 REVIEW_NEEDED 로 자동 강등 (모바일 노출 X).
        if (uploadGate === 'BLOCKED') {
          if (isSupabaseConfigured) {
            const correctionRows = validation.errors.map(e => ({
              field_path: e.match(/\[([^\]]+)\]/)?.[1] ?? 'unknown',
              reflection: `업로드 파싱 실패: ${e}`,
              before_value: null,
              after_value: null,
              raw_text_excerpt: (parsedDocument.rawText ?? '').slice(0, 500),
              severity: 'critical',
              category: 'parse_failure',
              land_operator_id: effectiveLandOperatorId,
              destination: ed.destination ?? tempDest ?? null,
              is_active: true,
              applied_count: 0,
            }));
            supabaseAdmin.from('extractions_corrections').insert(correctionRows)
              .then(() => {}).catch((e: Error) => console.warn('[Upload API] corrections 기록 실패(무시):', e.message));
          }
          scheduleUploadReviewInsert({
            severity: 'critical',
            error_reason: `BLOCKED: ${validation.errors.join(' | ')}`,
            source_filename: fileName,
            file_hash: fileHash,
            normalized_content_hash: normalizedCatalogHash,
            raw_text_chunk: (parsedDocument.rawText ?? '').slice(0, 12000),
            parsed_draft_json: ed as unknown as Record<string, unknown>,
            product_title: title,
            land_operator_id: effectiveLandOperatorId,
          });
          console.warn(`[Upload API] BLOCKED 분기 — INSERT 강행 + REVIEW_NEEDED 강등 (어드민 상품관리에서 보완 가능)`);
          // ⚠️ continue 없음 — INSERT 까지 진행
        }

        // REVIEW_NEEDED: confidence 낮음 → 저장 후 수동 검토 필요 패턴 기록
        if (uploadGate === 'REVIEW_NEEDED' && isSupabaseConfigured) {
          const warnRows = validation.warnings.map(w => ({
            field_path: 'confidence',
            reflection: `낮은 파싱 신뢰도: ${w}`,
            before_value: null,
            after_value: null,
            raw_text_excerpt: (parsedDocument.rawText ?? '').slice(0, 500),
            severity: 'high',
            category: 'low_confidence',
            land_operator_id: effectiveLandOperatorId,
            destination: ed.destination ?? tempDest ?? null,
            is_active: true,
            applied_count: 0,
          }));
          supabaseAdmin.from('extractions_corrections').insert(warnRows)
            .then(() => {}).catch(() => {});
        }

        // ── G4. 상태 결정 ────────────────────────────────────────────────────

        let productStatus = determineProductStatus({
          confidence,
          netPrice,
          priceRowCount:    priceRows.length,
          isTravel:         classification.isTravel,
          departureDateStr: ed.ticketing_deadline ?? null,
        });

        // 2026-05-15 INT-3: Customer-Ready Gate — data + UX + paraphrase 통과 시 status='approved' 자동.
        //   사장님 손 떼기 (UX-6). 실패 사유는 BLOCK / 권고는 WARN 으로 분리.
        try {
          const { evaluateCustomerReadyGate } = await import('@/lib/parser/customer-ready-gate');
          const gate = evaluateCustomerReadyGate({
            ed,
            netPrice,
            priceRowCount: priceRows.length,
            confidence,
            hasItinerary: !!product.itineraryData?.days?.length,
            hasThumbnail: false, // auto-photo-match 이후 채워짐 (지금 단계에선 unknown)
          });
          if (gate.ready) {
            productStatus = 'approved' as typeof productStatus;
            console.log(`[Upload API] Customer-Ready Gate: ✅ APPROVED 자동 활성화`);
          } else {
            const summary = [
              gate.reasons.length > 0 ? `reasons: ${gate.reasons.join(', ')}` : null,
              gate.warnings.length > 0 ? `warnings: ${gate.warnings.join(', ')}` : null,
            ].filter(Boolean).join(' | ');
            console.log(`[Upload API] Customer-Ready Gate: ${gate.reasons.length > 0 ? '🔴' : '🟡'} ${summary}`);
          }
        } catch (e) {
          console.warn('[Upload API] Customer-Ready Gate 실패 (무시):', (e as Error).message);
        }

        console.log(`[Upload API] 상태 결정: ${productStatus} (confidence=${(confidence * 100).toFixed(0)}%)`);

        // ── G5. products 테이블 INSERT (Phase 1 + Phase 2 신규 컬럼 포함) ────

        if (isSupabaseConfigured && internalCode) {
          const { error: productError } = await supabaseAdmin
            .from('products')
            .insert({
              // 기존 필드
              internal_code:         internalCode,
              display_name:          title,
              departure_region:      departureRegion,
              supplier_code:         effectiveSupplierCode,
              departure_date:        ed.ticketing_deadline ?? null,
              net_price:             netPrice,
              margin_rate:           marginRate,
              discount_amount:       0,
              ai_tags:               ed.product_tags ?? [],
              internal_memo:         null,
              source_filename:       fileName,
              land_operator_id:      effectiveLandOperatorId,
              departing_location_id: departingLocationId,
              // Phase 2 신규 필드
              status:                productStatus,
              ai_confidence_score:   Math.round(confidence * 100),
              theme_tags:            ed.theme_tags ?? [],
              selling_points:        ed.selling_points ?? null,
              flight_info:           ed.flight_info ?? null,
              raw_extracted_text:    maskSensitiveRawText(
                parsedDocument.rawText,
                landOps?.find((lo: { id: string; name: string }) => lo.id === effectiveLandOperatorId)?.name ?? filenameRule.supplierRaw,
              ).slice(0, 50000),
              thumbnail_urls:        [],
            });

          if (productError) {
            throw new Error(`products 저장 실패: ${productError.message}`);
          }
          productInserted = true;
          console.log('[Upload API] products INSERT 완료:', internalCode, `(${productStatus})`);
        }

        // ── G6. product_prices 1:N 원자 저장 ─────────────────────────────────

        if (isSupabaseConfigured && internalCode && priceRows.length > 0) {
          const priceInsertRows = priceRows.map(r => ({ ...r, product_id: internalCode }));
          const { error: priceError } = await supabaseAdmin
            .from('product_prices')
            .insert(priceInsertRows);

          if (priceError) {
            // product_prices 실패는 products 롤백 하지 않음 — REVIEW_NEEDED 상태로 유지
            console.warn('[Upload API] product_prices 저장 실패 (상품 유지):', priceError.message);
          } else {
            totalPriceRowsSaved += priceRows.length;
            console.log('[Upload API] product_prices INSERT 완료:', priceRows.length, '행');
          }
        }

        // ── G7. 마케팅 카피 AI 생성 (벌크 모드 시 스킵) ─────────────

        let marketingCopies: MarketingCopy[] = [];
        { // 마케팅카피 항상 스킵 (토큰 절약 — 필요시 별도 생성)
          console.log('[Upload API] 마케팅 카피 스킵 (토큰 절약)');
        } if (false) try {
          marketingCopies = await generateMarketingCopies({
            destination: ed.destination ?? '',
            duration:    ed.duration    ?? 5,
            price:       ed.price       ?? 0,
            highlights:  ed.product_highlights ?? [],
            inclusions:  ed.inclusions  ?? [],
            rawText:     parsedDocument.rawText.slice(0, 3000),
          });
          console.log('[Upload API] 마케팅 카피 생성 완료:', marketingCopies.length, '종');
        } catch (copyErr) {
          console.warn('[Upload API] 마케팅 카피 생성 실패 (비중단):', copyErr);
        }

        // ── G8. travel_packages 테이블 INSERT (고객 노출용 + FK 연결) ─────────

        // L2 박제 (2026-05-16): Phase 2 LLM 추출 실패 시 deterministic day-table 파서 fallback.
        //   사장님 솔루션: "표 형식 텍스트 파싱 약하면 나눠서 처리". 트립박스 ERP 표준.
        //   청도 사고 (itinerary_data=null) 재발 차단.
        let itineraryInput = (product.itineraryData ?? null) as ItineraryDataLike | null;
        if (!itineraryInput?.days?.length && parsedDocument.rawText) {
          try {
            const { parseDayTable } = await import('@/lib/parser/deterministic/day-table');
            const detResult = parseDayTable(parsedDocument.rawText);
            if (detResult.days.length > 0 && detResult.confidence >= 0.4) {
              console.log(`[Upload API] Phase 2 LLM 실패 → day-table deterministic fallback: ${detResult.days.length} days (conf=${detResult.confidence.toFixed(2)})`);
              itineraryInput = detResult as unknown as ItineraryDataLike;
              // ed 의 airline 도 보강 (null 이면)
              if (!ed.airline && detResult.meta.airline) {
                (ed as { airline?: string | null }).airline = detResult.meta.airline;
              }
            }
          } catch (e) {
            console.warn('[Upload API] day-table fallback 실패(무시):', e instanceof Error ? e.message : e);
          }
        }
        const enrichment = enrichItineraryWithAttractionReferences(
          itineraryInput,
          activeAttractions,
          ed.destination,
        );

        // C1 박제 (2026-05-15): 신뢰도 V3 — schedule 매칭률을 V2 산식에 반영.
        //   enrichment 결과로 schedule item count 계산 → V2 재호출 with attractionStats.
        //   비용 0 (deterministic 재실행). 사장님 비전 "100% 신뢰도 거짓 신호" 차단.
        let scheduleItemCount = 0;
        for (const day of itineraryInput?.days ?? []) {
          for (const s of day.schedule ?? []) {
            if (!s.activity) continue;
            const t = (s as { type?: string }).type;
            if (t === 'flight' || t === 'hotel' || t === 'shopping') continue;
            scheduleItemCount++;
          }
        }
        const v2WithAttraction = calculateConfidenceV2(ed, {
          leakScore: sanitizeResult.leakScore,
          itineraryData: product.itineraryData as unknown as { days?: Array<{ schedule?: Array<{ type?: string }>; hotel?: { name?: string | null } }>; meta?: { airline?: string | null; flight_out?: string | null; flight_in?: string | null } } | undefined,
          policy: autoGatePolicy,
          attractionStats: {
            matchedCount: enrichment.matchedCanonicalNames.length,
            unmatchedCount: enrichment.unmatchedCandidates.length,
            scheduleItemCount,
          },
        });
        // V3 confidence 가 V2 보다 낮으면 사장님이 보는 신뢰도도 V3 로 갱신
        const confidenceV3 = v2WithAttraction.confidence;
        const v3Checks = v2WithAttraction.checks;
        const v3FailedChecks = v3Checks.filter(c => !c.passed);
        // flight_segments 정규화: schedule[type='flight'] 흩어진 항공편을 정규 필드로
        // 박제 사유 (2026-05-13): 익일 도착·도착시간 누락으로 카드 깨짐 영구 차단
        // P10-3 박제 (2026-05-13): itinerary 정규화 — 호텔 grade / 식사 카운트 / 호텔명 dedupe / regions
        const _rawItin = (enrichment.itineraryData ?? product.itineraryData ?? null) as unknown;
        const _normalized = normalizeItinerary(_rawItin as Parameters<typeof normalizeItinerary>[0]);
        const itineraryDataToSave = normalizeFlightSegments(
          _normalized as unknown as Parameters<typeof normalizeFlightSegments>[0]
        ) ?? null;
        enrichment.matchedCanonicalNames.forEach(name => matchedCanonicalNames.add(name));
        for (const day of itineraryDataToSave?.days ?? []) {
          for (const s of day.schedule ?? []) {
            if (s.type === 'flight' || s.type === 'hotel' || !s.activity) continue;
            const cands = extractAttractionCandidates(s.activity, s.note);
            for (const c of cands) extractedCandidateRows.push({ activity: c, destination: ed.destination });
          }
        }

        if (isSupabaseConfigured) {
          const { data: pkgResult, error: pkgError } = await supabaseAdmin
            .from('travel_packages')
            .insert({
              title,
              destination:           ed.destination,
              duration:              ed.duration,
              price:                 ed.price,
              filename:              fileName,
              file_type:             parsedDocument.fileType,
              raw_text:              parsedDocument.rawText,
              // X3 박제 (2026-05-15): SKILL.md Rule Zero — raw_text_hash 자동 박제. 사후 변조 탐지용.
              raw_text_hash:         createHash('sha256').update(parsedDocument.rawText ?? '').digest('hex'),
              itinerary:             ed.itinerary        ?? [],
              inclusions:            ed.inclusions       ?? [],
              excludes:              ed.excludes         ?? [],
              accommodations:        ed.accommodations   ?? [],
              special_notes:         ed.specialNotes,
              notices_parsed:        ed.notices_parsed    ?? [],
              confidence:            confidenceV3,
              category:              ed.category         ?? 'package',
              product_type:          ed.product_type,
              trip_style:            ed.trip_style,
              departure_days:        ed.departure_days,
              departure_airport:     ed.departure_airport ?? '부산(김해)',
              airline:               ed.airline,
              min_participants:      ed.min_participants  ?? 4,
              ticketing_deadline:    ed.ticketing_deadline ?? null,
              guide_tip:             ed.guide_tip,
              single_supplement:     ed.single_supplement,
              small_group_surcharge: ed.small_group_surcharge,
              price_tiers:           ed.price_tiers       ?? [],
              price_dates:           tiersToDatePrices(ed.price_tiers ?? []),
              price_list:            ed.price_list        ?? [],
              surcharges:            ed.surcharges        ?? [],
              excluded_dates:        ed.excluded_dates    ?? [],
              // optional_tours 다형성 (객체/문자열 혼재) 정규화 강제 — package-acl SSOT.
              // (2026-05-22 박제) DetailClient 의 view.optionalToursByRegion 가 정규 객체 가정.
              optional_tours:        normalizeOptionalTours(ed.optional_tours) ?? [],
              cancellation_policy:   ed.cancellation_policy ?? [],
              category_attrs:        ed.category_attrs   ?? {},
              land_operator:         filenameRule.supplierRaw ?? ed.land_operator ?? null,
              land_operator_id:      effectiveLandOperatorId,
              departing_location_id: departingLocationId,
              commission_rate:       filenameRule.marginRate != null ? filenameRule.marginRate * 100 : null,
              product_tags:          ed.product_tags      ?? [],
              product_highlights:    ed.product_highlights ?? [],
              product_summary:       ed.product_summary   ?? null,
              itinerary_data:        itineraryDataToSave,
              // X3 박제 (2026-05-15 SKILL.md Step 7-A): audit_status=clean + V3 신뢰도 ≥ 0.85 자동 approve.
              // 사장님 비전 "사장님은 PDF 만 붙여넣음 — 등록·감사·승인 전부 Agent" 달성.
              // V3 신뢰도 낮거나 critical fail 있으면 pending_review (사장님 force 결정 필요).
              status:                (confidenceV3 >= 0.85 && v3FailedChecks.filter(c => c.severity === 'critical').length === 0)
                                       ? 'approved'
                                       : 'pending_review',
              marketing_copies:      marketingCopies,
              internal_code:         internalCode ?? null,
            })
            .select()
            .single();

          if (pkgError) {
            throw new Error(`travel_packages 저장 실패: ${pkgError.message}`);
          }

          if (pkgResult?.id) {
            savedIds.push(pkgResult.id);
            savedTitles.push(title);

            // ── G8.5. ai_quality_log 적재 — V2 + leak incidents + LLM 메타 (P11-4)
            const llmMeta = (ed as { _llm_meta?: Record<string, unknown> })._llm_meta ?? {};
            // B1 박제 (2026-05-15): 관광지 매칭 통계 — 사장님 시각 검증용
            //   reflected 는 multi-product loop 종료 후 별도 UPDATE (시드 후 재반영 시점에)
            const pkgMatchedCount   = enrichment.matchedCanonicalNames.length;
            const pkgUnmatchedCount = enrichment.unmatchedCandidates.length;
            void supabaseAdmin
              .from('ai_quality_log')
              .insert({
                package_id:        pkgResult.id,
                internal_code:     internalCode,
                confidence:        confidenceV3,
                fill_score:        v2WithAttraction.fillScore,
                xvalid_score:      v2WithAttraction.crossValidationScore,
                leak_score:        v2WithAttraction.leakScore,
                auto_gate:         v2WithAttraction.autoGate,
                failed_checks:     v3FailedChecks,
                leak_incidents:    sanitizeResult.incidents,
                // P11-4 박제: LLM 호출 메타 자동 채움 (자체 LLMOps cost tracking)
                advisor_escalated: Boolean(llmMeta.advisor_used),
                llm_providers:     llmMeta.provider ? [String(llmMeta.provider)] : [],
                llm_tokens_input:  Number(llmMeta.tokens_input ?? 0),
                llm_tokens_output: Number(llmMeta.tokens_output ?? 0),
                llm_calls_count:   1 + (llmMeta.advisor_used ? 1 : 0),
                // B1 박제: 패키지 단위 관광지 매칭 통계
                attraction_matched_count:   pkgMatchedCount,
                attraction_unmatched_count: pkgUnmatchedCount,
                attraction_seeded_count:    0, // 시드는 loop 종료 후 일괄 — 별도 UPDATE
                attraction_reflected_count: 0,
              })
              .then(({ error }: { error: { message: string } | null }) => {
                if (error) console.warn('[Upload API] ai_quality_log 적재 실패(무시):', error.message);
              });

            // Y1 박제 (2026-05-15): silent fail 근본 차단.
            //   Next.js 15.5 stable `after` API — Vercel serverless 응답 반환 후도 백그라운드 task 완수 보장.
            //   기존 `void` fire-and-forget 은 함수 종료 시 죽었음 → admin_alerts 적재 silent fail.
            const pkgIdForAudit = pkgResult.id;
            nextAfter(async () => {
              try {
                await Promise.allSettled([
                  runCoVeInBackground(pkgIdForAudit),
                  runUploadVerify(pkgIdForAudit),
                  runAutoMobileQA(pkgIdForAudit),
                ]);
              } catch (e) {
                console.warn('[upload-after] post-audit 묶음 실패:', e instanceof Error ? e.message : e);
              }
            });

            // 랜드사 프로파일 자동 누적도 after 로 — 응답 반환 후 안전 실행
            if (effectiveLandOperatorId) {
              const profileArgs = {
                landOperatorId:    effectiveLandOperatorId,
                rawText:           parsedDocument.rawText ?? '',
                confidence:        confidenceV3,
                rejected:          v2WithAttraction.autoGate === 'rejected',
                detectedB2bTerms:  sanitizeResult.incidents
                  .filter(i => i.severity !== 'medium')
                  .map(i => i.matched),
              };
              nextAfter(async () => {
                try { await accumulateLandOperatorProfile(profileArgs); }
                catch (e) { console.warn('[upload-after] land-operator profile 실패:', e instanceof Error ? e.message : e); }
              });
            }

            // Phase 8-2 박제 — Pexels 자동 매칭 (검수 큐에서 1-click 선택 가능)
            if (internalCode) {
              void runAutoPhotoMatch({
                internalCode,
                destination: ed.destination ?? null,
                title,
              });
            }
          }
          if (internalCode) {
            savedInternalCodes.push(internalCode);
          }

          console.log('[Upload API] travel_packages INSERT 완료:', pkgResult?.id, '← FK:', internalCode);

          // MRT 3-Tier Hybrid: Tier 2 Lazy On-Demand (2026-05-14 박제)
          //   destination 의 MRT canonical attraction 이 부족하면 백그라운드로 sync 트리거.
          //   다음 등록부터 fast match. fire-and-forget — 등록 흐름 지연 0.
          void maybeTriggerMrtSync(ed.destination ?? null);

          // 호텔 빈도 기반 canonical 학습 (사장님 인사이트, 2026-05-14 박제)
          //   itinerary_data.days[].hotel.name 을 hotel_canonical 테이블에 누적 →
          //   3회 이상 등장 → 자동 canonical 승격. fuzzy 0.85 로 표기 변형 흡수.
          void recordHotelsFromItinerary({
            itineraryData: product.itineraryData,
            destination: ed.destination ?? null,
            country: null,
          });

          // ── 미매칭 관광지 자동 수집 (정규화 후보 기반) ──────────────────────
          if (pkgResult?.id && enrichment.unmatchedCandidates.length > 0) {
            for (const u of enrichment.unmatchedCandidates) {
              unmatchedRowsToInsert.push({
                activity: u.activity,
                package_id: pkgResult.id,
                package_title: title,
                day_number: u.day_number,
                country: ed.destination || null,
              });
            }
          }
        }

      } catch (saveErr) {
        // ── 보상 트랜잭션: products만 삽입됐으면 롤백 ──────────────────────
        if (productInserted && internalCode && isSupabaseConfigured) {
          console.warn('[Upload API] 보상 롤백 실행 — products 삭제:', internalCode);
          await supabaseAdmin
            .from('products')
            .delete()
            .eq('internal_code', internalCode)
            .then(({ error: rollbackErr }: { error: { message: string } | null }) => {
              if (rollbackErr) {
                console.error('[Upload API] 롤백 실패 (수동 확인 필요):', rollbackErr.message, internalCode);
              } else {
                console.log('[Upload API] 롤백 완료:', internalCode);
              }
            });
        }

        const errMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
        console.error('[Upload API] 상품 저장 오류:', { title, error: errMsg });
        scheduleUploadReviewInsert({
          severity: 'high',
          error_reason: errMsg,
          source_filename: fileName,
          file_hash: fileHash,
          normalized_content_hash: normalizedCatalogHash,
          raw_text_chunk: (parsedDocument.rawText ?? '').slice(0, 12000),
          parsed_draft_json: ed as unknown as Record<string, unknown>,
          product_title: title,
          land_operator_id: effectiveLandOperatorId,
        });
        saveErrors.push({ title, error: errMsg });
      }
    }

    // ── [H-1] 관광지 마스터 DB 자동 구축 (벌크 모드 시 스킵) ──────────────────────
    if (isSupabaseConfigured && !bulkMode) {
      try {
        if (unmatchedRowsToInsert.length > 0) {
          for (const u of unmatchedRowsToInsert) {
            await supabaseAdmin.from('unmatched_activities').upsert({
              activity: u.activity,
              package_id: u.package_id,
              package_title: u.package_title,
              day_number: u.day_number,
              country: u.country,
              occurrence_count: 1,
              status: 'pending',
            }, { onConflict: 'activity' });
          }
          console.log(`[Upload API] 미매칭 관광지 ${unmatchedRowsToInsert.length}개 수집됨`);
        }

        if (extractedCandidateRows.length > 0) {
          const allActivities = extractedCandidateRows;
          const existingNames = new Set(
            activeAttractions.map((a: AttractionData) => a.name.toLowerCase().replace(/\s+/g, '')),
          );

          // Gemini에 신규 관광지만 한 번에 설명 생성 요청
          const newActivities = allActivities.filter(
            a => !existingNames.has(a.activity.toLowerCase().replace(/\s+/g, '')),
          );

          // 기존 관광지 mention_count 증가 (정규명 매칭 성공분 기준)
          // ⚠️ supabase rpc() 는 PromiseLike 라 .catch 가 없음 → .then(undefined, …) 사용
          // (PostgrestBuilder 가 PromiseLike 만 구현. .catch() 시 "is not a function" throw 후
          //  외부 try/catch 가 잡아 attractions 학습 블록 전체가 매번 silently 실패해 왔음.)
          for (const name of [...matchedCanonicalNames]) {
            await supabaseAdmin
              .rpc('increment_mention_count', { attraction_name: name })
              .then(undefined, () => {});
          }

          // ── STRICT SSOT 정책 (2026-05-16, 옵션 1 박제) ──────────────────────
          //   사장님 의도: attractions 테이블 = 사장님이 관리하는 SSOT. 매칭만 시키고,
          //   매칭 실패 시 신규 INSERT 하지 않음. unmatched_activities 큐에 적재 → 사장님이
          //   어드민에서 alias 추가 또는 신규 attraction 등록 결정.
          //
          //   ⚠️ 폐기된 자동 시드 (autoSeedAttraction): Wikidata/Wikipedia/LLM paraphrase 통과 시
          //   자동 INSERT 하던 로직. verbatim 라인이 paraphrase 흡사로 통과해 DB 오염
          //   ("중국보존건축물중 가장 완전한 서안성벽+함광문유적지박물관" 등 박힘 사고).
          //   ERR-XIY-2026-05-16: 사장님이 2달간 "이미 등록된 attraction 에 매칭만, 새거면
          //   사장님이 직접 등록한다" 지시를 정규식 가드로 우회하던 패턴 종결.
          //
          //   유지: matched canonical mention_count 증가 / unmatched_activities 적재 / alias 자동학습.
          //   비활성: autoSeedAttraction 호출, Same-Session Seed-Reflect (시드가 없으므로 무용).
          //
          //   향후 신규 시드 경로: 사장님 어드민 UI 직접 등록 또는 외부 카탈로그 paste 도구.
          if (newActivities.length > 0) {
            const firstSeedDest = newActivities.find(a => a.destination)?.destination ?? null;
            // 2026-05-17 박제 (ERR-shizuoka-country-destination):
            //   기존 `country: firstSeedDest` 가 '시즈오카' 같은 한글 도시명을 country 컬럼에 박아
            //   attractions.country='시즈오카'(ISO 아님) → page.tsx OR clause 매칭 실패 → 모바일
            //   카드 0건 사고. country 는 ISO2, region 은 한글 destination 으로 분리.
            const { inferCountryFromDestination } = await import('@/lib/destination-iso');
            const firstSeedCountry = inferCountryFromDestination(firstSeedDest);
            const uniqueNew = [...new Set(newActivities.map(a => a.activity))].slice(0, 30);
            for (const kw of uniqueNew) {
              await supabaseAdmin.from('unmatched_activities').upsert({
                activity: kw,
                package_id: savedIds[0] ?? '',
                package_title: savedTitles[0] ?? '',
                day_number: 0,
                country: firstSeedCountry,
                region: firstSeedDest,
                occurrence_count: 1,
                status: 'pending',
              }, { onConflict: 'activity' });
            }
            console.log(`[Upload API] STRICT SSOT: ${uniqueNew.length}건 unmatched 큐 적재 (자동 시드 비활성)`);

            // PR #94 갭 D — 신규 지역 부트스트랩 자동화.
            //   시즈오카 사고 (모바일 attraction 카드 0개) 영구 차단.
            //   백그라운드 DeepSeek 으로 카드 분해 → unmatched_activities.suggested_card 적재.
            //   사장님 어드민 ☑ 한 번 → 일괄 attractions INSERT → reEnrichAffectedPackages → 모바일 즉시 반영.
            //   fire-and-forget (사장님 응답 블로킹 X).
            const trigPackageId = savedIds[0];
            if (trigPackageId && uniqueNew.length > 0) {
              void (async () => {
                try {
                  const { bootstrapNewRegionAsync } = await import('@/lib/auto-bootstrap-new-region');
                  const r = await bootstrapNewRegionAsync({
                    packageId: trigPackageId,
                    region: firstSeedDest,
                    country: firstSeedCountry,
                    activities: uniqueNew,
                  });
                  console.log(`[Upload API] Bootstrap: ${r.suggested}건 suggested_card 적재 (alert=${r.alerted})`);
                } catch (e) {
                  console.warn('[Upload API] Bootstrap 실패(무시):', e instanceof Error ? e.message : e);
                }
              })();
            }
          }
        }
      } catch (attrError) {
        console.warn('[Upload API] attractions 처리 실패 (비중단):', attrError instanceof Error ? attrError.message : attrError);
      }
    }

    // ── [G2] LLM 기반 itinerary 재추출 (2026-05-17 박제) ─────────────────────────
    //   기존 regex parser 가 잡지 못하는 5가지 랜드사 패턴 (▶헤딩\n부속코스,
    //   ▶<설명><이름>, ▶<영역>\n-<부속>, "및" 분리 등) 을 DeepSeek Flash 로 정확히
    //   재추출. fire-and-forget — 사장님 응답 블로킹 안 함.
    //   비용: 패키지 1개당 ~$0.001. backfill 시 더 큰 batch 도 동일.
    if (savedIds.length > 0) {
      for (const pkgId of savedIds) {
        void (async () => {
          try {
            // 2026-05-17 박제 (CLAUDE.md 12절 hierarchy): L1(rule) → L2(fuzzy) → L3(LLM) → L4(human).
            const { backfillPackageAttractionsL3 } = await import('@/lib/itinerary-llm-extractor');
            const r = await backfillPackageAttractionsL3(pkgId, { skipIfMatchRateAbove: 0.9 });
            if (r.ok) {
              console.log(`[Upload API] L3 attractions: ${pkgId.slice(0, 8)} ${((r.before ?? 0) * 100).toFixed(0)}% → ${((r.after ?? 0) * 100).toFixed(0)}%`);
            } else {
              console.warn(`[Upload API] L3 attractions skip/fail: ${pkgId.slice(0, 8)} — ${r.reason}`);
            }
          } catch (e) {
            console.warn('[Upload API] L3 attractions 예외(무시):', e instanceof Error ? e.message : e);
          }
          // 2026-05-17 박제 (CLAUDE.md 12절 — 7 도메인 hierarchy 전체 적용):
          //   hero context (destination/title/summary/tagline) + price_dates + inclusions/excludes/notices
          //   기존 parser 가 NULL/0건/빈약하면 LLM L3 fallback. force=false (기존 값 보존).
          try {
            const { backfillSectionsByPackageId } = await import('@/lib/parser/llm/section-extractors');
            const s = await backfillSectionsByPackageId(pkgId, { force: false });
            console.log(`[Upload API] L3 sections: ${pkgId.slice(0, 8)} hero=${s.hero?.applied} price=${s.price?.applied}(${s.price?.rowCount ?? 0}) notices=${s.notices?.applied}`);
          } catch (e) {
            console.warn('[Upload API] L3 sections 예외(무시):', e instanceof Error ? e.message : e);
          }
        })();
      }
    }

    // ── [H] document_hashes 기록 (파싱 완료 후 해시 저장) ────────────────────

    if (isSupabaseConfigured && savedInternalCodes.length > 0) {
      await supabaseAdmin
        .from('document_hashes')
        .insert({
          file_hash:         fileHash,
          file_name:         fileName,
          normalized_hash:   normalizedCatalogHash,
          product_id:        savedInternalCodes[0], // 대표 internal_code
        })
        .then(({ error: hashErr }: { error: { message: string } | null }) => {
          if (hashErr) console.warn('[Upload API] document_hashes 기록 실패 (비중단):', hashErr.message);
          else         console.log('[Upload API] document_hashes 기록 완료:', fileHash.slice(0, 12));
        });
    }

    // ── [I] 응답 ──────────────────────────────────────────────────────────────

    const productCount = productsToSave.length;
    const successCount = savedIds.length;

    // 상품별 게이트 집계 (UI에 요약 표시)
    const blockedCount = saveErrors.filter(e => e.error.includes('BLOCKED')).length;
    const overallGate: UploadGate = blockedCount > 0 && successCount === 0
      ? 'BLOCKED'
      : blockedCount > 0
        ? 'REVIEW_NEEDED'
        : 'CLEAN';

    // ── 토큰 사용량 비용 환산 (Phase 1 + Phase 2 합산) ───────────────────────
    const tu = parsedDocument._tokenUsage;
    const tokenInfo = tu ? (() => {
      // Phase 1: DeepSeek V4 Flash: input $0.14/M, cache_hit $0.014/M, output $0.28/M
      // Phase 1: Gemini 2.5 Flash: input $0.30/M, output $2.50/M
      const billableInput = tu.input - tu.cache_hit;
      const phase1CostUsd = tu.provider === 'deepseek'
        ? (tu.cache_hit / 1_000_000 * 0.014) + (billableInput / 1_000_000 * 0.14) + (tu.output / 1_000_000 * 0.28)
        : (tu.input / 1_000_000 * 0.30) + (tu.output / 1_000_000 * 2.50);
      // Phase 2: 일정표 추출 (텍스트=DeepSeek, 이미지=Gemini)
      const p2in = tu.phase2Input ?? 0;
      const p2out = tu.phase2Output ?? 0;
      const p2cache = tu.phase2CacheHit ?? 0;
      const phase2CostUsd = tu.phase2Provider === 'gemini'
        ? (p2in / 1_000_000 * 0.30) + (p2out / 1_000_000 * 2.50)
        : (p2cache / 1_000_000 * 0.014) + ((p2in - p2cache) / 1_000_000 * 0.14) + (p2out / 1_000_000 * 0.28);
      return {
        provider:    tu.provider,
        inputTokens: tu.input,
        outputTokens: tu.output,
        cacheHitTokens: tu.cache_hit,
        phase2Provider: tu.phase2Provider ?? 'deepseek',
        phase2InputTokens:  p2in,
        phase2OutputTokens: p2out,
        phase2CacheHitTokens: p2cache,
        costUsd: Math.round((phase1CostUsd + phase2CostUsd) * 1_000_000) / 1_000_000,
        elapsed_ms: tu.elapsed_ms,
      };
    })() : null;

    // A3 박제 (2026-05-15): 등록 종료 한 화면 통계 — 사장님 비전 "다음번 등록 시 자동" 가시화
    const attractionStats = {
      matched: matchedCanonicalNames.size,
      unmatched: unmatchedRowsToInsert.length,
      seeded: attractionSeededCount,
      reflected: attractionReflectedCount,
    };
    const attractionLine = attractionStats.matched + attractionStats.seeded + attractionStats.unmatched > 0
      ? ` · 관광지 매칭 ${attractionStats.matched}개${attractionStats.seeded > 0 ? ` · 신규 시드 ${attractionStats.seeded}개` : ''}${attractionStats.reflected > 0 ? ` · 같은 등록 즉시반영 ${attractionStats.reflected}개` : ''}${attractionStats.unmatched > 0 ? ` · 미매칭 ${attractionStats.unmatched}개 (검수 큐로)` : ''}`
      : '';

    // X3 박제 (2026-05-15 SKILL.md Step 7-C): 한 화면 표준 리포트.
    // 사장님이 PDF 만 붙여넣고 어드민 UI 에서 즉시 확인 가능한 풀 상태 (short_code / 가격 / 출발일 / 항공편 / status / 모바일 URL).
    let registerReport: Array<Record<string, unknown>> = [];
    if (isSupabaseConfigured && savedIds.length > 0) {
      try {
        const { data: pkgs } = await supabaseAdmin
          .from('travel_packages')
          .select('id, internal_code, title, price, airline, status, departure_days')
          .in('id', savedIds);
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
        registerReport = ((pkgs ?? []) as Array<{ id: string; internal_code: string; title: string; price: number | null; airline: string | null; status: string; departure_days: string | null }>).map(p => ({
          short_code:   p.internal_code,
          title:        p.title,
          price:        p.price,
          airline:      p.airline,
          status:       p.status,
          departure_days: p.departure_days,
          mobile_url:   baseUrl ? `${baseUrl}/packages/${p.id}` : `/packages/${p.id}`,
          a4_url:       baseUrl ? `${baseUrl}/admin/packages/${p.id}/poster` : `/admin/packages/${p.id}/poster`,
        }));
      } catch { /* fail-soft */ }
    }

    return NextResponse.json({
      success: successCount > 0 || !isSupabaseConfigured,
      data:    parsedDocument,
      // 기존 호환성 유지
      dbId:    savedIds[0] ?? null,
      dbIds:   savedIds,
      titles:  savedTitles,
      // 내부 코드 목록
      internal_codes: savedInternalCodes,
      internal_code:  savedInternalCodes[0] ?? null,
      productCount,
      // Phase 2 신규
      priceRowsSaved:  totalPriceRowsSaved,
      fileHash:        fileHash.slice(0, 12) + '...',
      classification,
      gate:            overallGate,
      tokenUsage:      tokenInfo,
      attractionStats,
      // X3 박제 (2026-05-15): SKILL.md Step 7-C 표준 한 화면 리포트
      registerReport,
      ...(saveErrors.length > 0 && { errors: saveErrors }),
      message: productCount > 1
        ? `PDF에서 ${successCount}/${productCount}개 상품 등록 완료. 가격 행 ${totalPriceRowsSaved}개 저장됨.${attractionLine}`
        : successCount > 0
          ? `문서 파싱 완료. (${savedInternalCodes[0] ?? 'DB 미설정'}) 가격 ${totalPriceRowsSaved}행${attractionLine}`
          : '문서 파싱은 완료됐으나 DB 저장에 실패했습니다.',
    });

  } catch (error) {
    console.error('[Upload API] 치명적 오류:', {
      message: error instanceof Error ? error.message : String(error),
      stack:   error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error:   error instanceof Error ? error.message : '파일 처리에 실패했습니다.',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 },
    );
  }
}
