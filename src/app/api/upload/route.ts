import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { parseDocument, calculateConfidence, classifyDocument, type ParseOptions } from '@/lib/parser';
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
import { computeNormalizedContentHash } from '@/lib/parser/upload-text-hash';
import type { AttractionData } from '@/lib/attraction-matcher';
import { extractAttractionCandidates } from '@/lib/itinerary-attraction-candidates';
import { enrichItineraryWithAttractionReferences, type ItineraryDataLike } from '@/lib/itinerary-attraction-enricher';

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
  '계림': 'KWL', '구이린': 'KWL',
  '북경': 'PEK', '베이징': 'PEK',
  '상해': 'SHA', '상하이': 'SHA',
  '청두': 'CTU', '성도': 'CTU',
  '연길': 'YNJ', '백두산': 'YNJ', '장백산': 'YNJ',
  '황산': 'HFE',
  '곤명': 'KMG', '쿤밍': 'KMG',
  '서안': 'XIY', '시안': 'XIY',
  '중경': 'CKG', '충칭': 'CKG',
  '우루무치': 'URC',
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
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
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

    if (isSupabaseConfigured) {
      const { data: existingHash } = await supabaseAdmin
        .from('document_hashes')
        .select('file_hash, product_id, file_name')
        .eq('file_hash', fileHash)
        .maybeSingle();

      if (existingHash) {
        console.log('[Upload API] 중복 파일 감지 — 파싱 스킵:', fileHash.slice(0, 12));
        return NextResponse.json({
          success:       true,
          duplicate:     true,
          fileHash,
          internal_code: existingHash.product_id ?? null,
          message:       `이미 처리된 파일입니다. (원본: ${existingHash.file_name}) AI 파싱 토큰 절약.`,
        });
      }

      // 텍스트 붙여넣기: 띄어쓰기·개행만 다른 동일 카탈로그 사전 차단 (파싱 전)
      if (directRawText) {
        const normalizedContentHash = computeNormalizedContentHash(directRawText);
        const { data: existingNorm } = await supabaseAdmin
          .from('document_hashes')
          .select('file_hash, product_id, file_name, normalized_hash')
          .eq('normalized_hash', normalizedContentHash)
          .maybeSingle();

        if (existingNorm) {
          console.log('[Upload API] 정규화 해시 중복 — 파싱 스킵:', normalizedContentHash.slice(0, 12));
          return NextResponse.json({
            success:               true,
            duplicate:             true,
            duplicateReason:       'normalized_content',
            fileHash,
            normalizedContentHash: normalizedContentHash.slice(0, 16) + '…',
            internal_code:         existingNorm.product_id ?? null,
            message:               `이미 처리된 카탈로그입니다(본문 정규화 기준). 원본: ${existingNorm.file_name}`,
          });
        }
      }
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
      const [reflections, regionContext] = await Promise.all([
        getRelevantReflections(supabaseAdmin, {
          destination: tempDest || undefined,
          landOperatorId: prelimLandOperatorId || undefined,
          minSeverity: 'medium',
          limit: 5,
        }).catch(() => []),
        tempDest ? getRegionCacheContext(tempDest).catch(() => '') : Promise.resolve(''),
      ]);
      if (reflections.length > 0) {
        console.log('[Upload API] Reflexion 주입:', reflections.length, '건 (목적지:', tempDest, ')');
      }
      if (regionContext) {
        console.log('[Upload API] 지역 컨텍스트 로드:', tempDest, regionContext.length, '자');
      }
      parseOptions = { reflections, regionContext };
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
        const confidence = calculateConfidence(ed);
        const priceRows  = priceTiersToRows(ed);

        console.log(`[Upload API] 가격 행 ${priceRows.length}개 변환됨 (product_prices)`);

        // ── G3-B. 4단계 업로드 게이트 분류 ───────────────────────────────────

        const uploadGate: UploadGate = classifyUploadGate(validation, confidence, priceRows.length);
        console.log(`[Upload API] 업로드 게이트: ${uploadGate} (confidence=${(confidence * 100).toFixed(0)}%, priceRows=${priceRows.length})`);

        // BLOCKED: 핵심 필드 누락 → DB 저장 차단 + 자동 기록
        if (uploadGate === 'BLOCKED') {
          // 실패 패턴을 extractions_corrections에 자동 기록 (자가학습 flywheel)
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
          saveErrors.push({ title, error: `필수 필드 누락 (BLOCKED): ${validation.errors.join(', ')}` });
          continue; // DB INSERT 없이 다음 상품으로
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

        const productStatus = determineProductStatus({
          confidence,
          netPrice,
          priceRowCount:    priceRows.length,
          isTravel:         classification.isTravel,
          departureDateStr: ed.ticketing_deadline ?? null,
        });

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

        const itineraryInput = (product.itineraryData ?? null) as ItineraryDataLike | null;
        const enrichment = enrichItineraryWithAttractionReferences(
          itineraryInput,
          activeAttractions,
          ed.destination,
        );
        const itineraryDataToSave = enrichment.itineraryData ?? product.itineraryData ?? null;
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
              itinerary:             ed.itinerary        ?? [],
              inclusions:            ed.inclusions       ?? [],
              excludes:              ed.excludes         ?? [],
              accommodations:        ed.accommodations   ?? [],
              special_notes:         ed.specialNotes,
              notices_parsed:        ed.notices_parsed    ?? [],
              confidence,
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
              optional_tours:        ed.optional_tours    ?? [],
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
              status:                'pending_review',
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
          }
          if (internalCode) {
            savedInternalCodes.push(internalCode);
          }

          console.log('[Upload API] travel_packages INSERT 완료:', pkgResult?.id, '← FK:', internalCode);

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
          for (const name of [...matchedCanonicalNames]) {
            await supabaseAdmin.rpc('increment_mention_count', { attraction_name: name }).catch(() => {});
          }

          if (newActivities.length > 0) {
            const apiKey = process.env.GOOGLE_AI_API_KEY;
            if (apiKey) {
              const { GoogleGenerativeAI } = await import('@google/generative-ai');
              const genAI = new GoogleGenerativeAI(apiKey);
              const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.3 } });

              const uniqueNames = [...new Set(newActivities.map(a => a.activity))].slice(0, 30); // 최대 30개
              const dest = newActivities[0]?.destination || '';

              const prompt = `아래 여행 일정 텍스트에서 핵심 관광지/활동명을 추출하고, 1줄 설명과 이모지를 반환하세요.

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
${uniqueNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}

반환 형식 (JSON 배열만, 마크다운 없이):
[{"name":"짧은키워드","desc":"매력적 1줄 설명(15~25자)","category":"sightseeing","emoji":"🏛️","skip":false}]`;

              try {
                const result = await model.generateContent(prompt);
                const raw = result.response.text().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
                const attractions = JSON.parse(raw) as { name: string; desc: string; category: string; emoji: string; skip?: boolean }[];

                // skip이 아닌 항목만 DB에 UPSERT
                const toInsert = attractions
                  .filter(a => !a.skip && a.name && a.desc)
                  .map(a => ({
                    name: a.name,
                    short_desc: a.desc,
                    country: dest,
                    category: a.category || 'sightseeing',
                    emoji: a.emoji || '📍',
                    mention_count: 1,
                  }));

                if (toInsert.length > 0) {
                  await supabaseAdmin
                    .from('attractions')
                    .upsert(toInsert, { onConflict: 'name', ignoreDuplicates: false })
                    .then(({ error: upsertErr }: { error: { message: string } | null }) => {
                      if (upsertErr) console.warn('[Upload API] attractions UPSERT 경고:', upsertErr.message);
                      else console.log('[Upload API] attractions 등록:', toInsert.length, '개 신규');
                    });
                }
              } catch (attrErr) {
                console.warn('[Upload API] attractions 생성 실패 (비중단):', attrErr instanceof Error ? attrErr.message : attrErr);
              }
            }
          }
        }
      } catch (attrError) {
        console.warn('[Upload API] attractions 처리 실패 (비중단):', attrError instanceof Error ? attrError.message : attrError);
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
      ...(saveErrors.length > 0 && { errors: saveErrors }),
      message: productCount > 1
        ? `PDF에서 ${successCount}/${productCount}개 상품 등록 완료. 가격 행 ${totalPriceRowsSaved}개 저장됨.`
        : successCount > 0
          ? `문서 파싱 완료. (${savedInternalCodes[0] ?? 'DB 미설정'}) 가격 ${totalPriceRowsSaved}행`
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
