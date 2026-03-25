/**
 * 자비스 대량 예약 일괄 처리 유틸리티
 * bulk-process route + jarvis route 양쪽에서 import
 */
import { supabase, createBooking, upsertCustomer } from '@/lib/supabase';

// ─── 예약표 파서 (탭/공백 구분 모두 지원, Gemini 환각 방지용) ──────────────────
// 포맷: [날짜?] 이름 목적지 상태 랜드사
export function parseBulkTable(message: string): BulkItem[] | null {
  const lines = message.split('\n');
  const items: BulkItem[] = [];

  const korDateLineRe = /^(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)\s+(.+)/;
  const isoDateLineRe = /^(\d{4}-\d{2}-\d{2})\s+(.+)/;
  const nameOnlyLineRe = /^([가-힣a-zA-Z]{2,10})\s+([가-힣a-zA-Z]+)\s+(\S+)(.*)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 탭 구분 우선 처리
    if (trimmed.includes('\t')) {
      const parts = trimmed.split('\t');
      const col0 = parts[0]?.trim() ?? '';
      const col1 = parts[1]?.trim() ?? '';
      const col2 = parts[2]?.trim() ?? '';
      const col3 = parts[3]?.trim() ?? '';
      const col4 = parts.slice(4).join(' ').trim();
      const isDateOrEmpty = col0 === '' || /\d{4}년/.test(col0) || /^\d{4}-\d{2}-\d{2}$/.test(col0);
      if (isDateOrEmpty && col1) {
        items.push({ date: col0 || undefined, name: col1, destination: col2 || undefined, status: col3 || undefined, agency: col4 || undefined });
      }
      continue;
    }

    // 한글 날짜로 시작하는 줄
    const korMatch = trimmed.match(korDateLineRe);
    if (korMatch) {
      const datePart = korMatch[1];
      const rest = korMatch[2].trim().split(/\s{2,}|\t/);
      const cols = rest.length >= 2 ? rest : korMatch[2].split(' ');
      const name = cols[0]?.trim() ?? '';
      const dest = cols[1]?.trim() ?? '';
      const status = cols[2]?.trim() ?? '';
      const agency = cols.slice(3).join(' ').trim();
      if (name) items.push({ date: datePart, name, destination: dest || undefined, status: status || undefined, agency: agency || undefined });
      continue;
    }

    // ISO 날짜로 시작하는 줄
    const isoMatch = trimmed.match(isoDateLineRe);
    if (isoMatch) {
      const datePart = isoMatch[1];
      const cols = isoMatch[2].split(/\s+/);
      const name = cols[0]?.trim() ?? '';
      const dest = cols[1]?.trim() ?? '';
      const status = cols[2]?.trim() ?? '';
      const agency = cols.slice(3).join(' ').trim();
      if (name) items.push({ date: datePart, name, destination: dest || undefined, status: status || undefined, agency: agency || undefined });
      continue;
    }

    // 날짜 없이 이름만
    const nameMatch = trimmed.match(nameOnlyLineRe);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      const dest = nameMatch[2].trim();
      const status = nameMatch[3].trim();
      const agency = nameMatch[4].trim();
      const commandWords = ['예약처리', '처리해', '등록해', '조회', '알려줘', '보여줘'];
      if (!commandWords.some(w => name.includes(w))) {
        items.push({ name, destination: dest || undefined, status: status || undefined, agency: agency || undefined });
      }
    }
  }

  return items.length >= 2 ? items : null;
}

export interface BulkItem {
  date?: string;
  name: string;
  destination?: string;
  status?: string;
  agency?: string;
}

interface SuccessItem {
  name: string;
  destination: string;
  booking_no?: string;
}

interface FailedItem {
  name: string;
  date?: string;
  reason: string;
}

/** 어떤 타입의 에러든 메시지 문자열 추출 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    // Supabase PostgrestError: { message, details, hint, code }
    if (typeof e.message === 'string' && e.message) return e.message;
    if (typeof e.details === 'string' && e.details) return e.details;
    if (typeof e.code === 'string') return `DB 오류 코드: ${e.code}`;
  }
  return String(err) || '알 수 없는 오류';
}

/** "2026년 3월 14일" 또는 "2026-03-14" → "2026-03-14", 파싱 불가시 undefined */
function parseKoreanDate(raw?: string): string | undefined {
  if (!raw || raw.trim() === '') return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  const m = raw.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, '0');
    const d = m[3].padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return undefined;
}

/**
 * 한글 상태값 → DB 허용값 매핑
 * SQL 마이그레이션 미실행 환경에서도 안전하게 동작
 */
function mapStatus(raw?: string): string {
  const s = raw?.trim() ?? '';
  const map: Record<string, string> = {
    '상담중': 'pending',
    '예약중': 'pending',
    '가계약': 'pending',
    '확정':   'confirmed',
    '완료':   'completed',
    '취소':   'cancelled',
    'pending':   'pending',
    'confirmed': 'confirmed',
    'completed': 'completed',
    'cancelled': 'cancelled',
  };
  return map[s] ?? 'pending';
}

export async function processBulkReservations(items: BulkItem[]): Promise<{
  total: number;
  success_count: number;
  failed_count: number;
  success_list: SuccessItem[];
  failed_list: FailedItem[];
}> {
  const success_list: SuccessItem[] = [];
  const failed_list: FailedItem[] = [];

  for (const item of items) {
    if (!item.name || item.name.trim() === '') {
      failed_list.push({ name: '(이름 없음)', date: item.date, reason: '고객명 누락' });
      continue;
    }

    try {
      // 1. 고객명 정확 매칭 (exact match)
      const { data: existing, error: searchErr } = await supabase
        .from('customers')
        .select('id, name')
        .eq('name', item.name.trim());

      if (searchErr) throw new Error(`고객 조회 실패: ${extractErrorMessage(searchErr)}`);

      let customerId: string;

      if (!existing || existing.length === 0) {
        // 고객 없음 → 자동 생성 (신규 고객 auto-create)
        const newCustomer = await upsertCustomer({ name: item.name.trim() });
        customerId = (newCustomer as { id: string }).id;
      } else if (existing.length === 1) {
        // 기존 고객 사용
        customerId = (existing[0] as { id: string }).id;
      } else {
        // 동명이인 → 스킵
        throw new Error(`동명이인 ${existing.length}명 존재 — 후처리 필요`);
      }

      // 2. 예약 생성
      const booking = await createBooking({
        leadCustomerId: customerId,
        packageTitle: item.destination?.trim() || '미정',
        departureDate: parseKoreanDate(item.date),
        status: mapStatus(item.status),   // 한글 → DB 허용값 변환
        landOperator: item.agency?.trim() || undefined,
        adultCount: 1,
        childCount: 0,
        adultCost: 0,
        adultPrice: 0,
        childCost: 0,
        childPrice: 0,
        infantCount: 0,
        infantCost: 0,
        fuelSurcharge: 0,
      });

      success_list.push({
        name: item.name.trim(),
        destination: item.destination?.trim() || '미정',
        booking_no: (booking as { booking_no?: string })?.booking_no,
      });
    } catch (err) {
      failed_list.push({
        name: item.name.trim(),
        date: item.date,
        reason: extractErrorMessage(err),   // 실제 에러 메시지 그대로
      });
      // 절대 멈추지 않고 다음 항목으로 계속
    }
  }

  return {
    total: items.length,
    success_count: success_list.length,
    failed_count: failed_list.length,
    success_list,
    failed_list,
  };
}
