import { supabaseAdmin } from '@/lib/supabase';
import { detectKnownMojibakeSupplierProfile } from './supplier-mojibake-standardization';

export const UPLOAD_REGION_CODE_MAP: Record<string, string> = {
  부산: 'PUS',
  김해: 'PUS',
  인천: 'ICN',
  서울: 'ICN',
  김포: 'GMP',
  제주: 'CJU',
  대구: 'TAE',
  청주: 'CJJ',
  광주: 'KWJ',
};

export const UPLOAD_DEST_CODE_MAP: Record<string, string> = {
  오사카: 'OSA',
  도쿄: 'TYO',
  동경: 'TYO',
  나리타: 'TYO',
  치바: 'TYO',
  죠시: 'TYO',
  조시: 'TYO',
  후쿠오카: 'FUK',
  큐슈: 'FUK',
  규슈: 'FUK',
  북큐슈: 'FUK',
  벳부: 'FUK',
  벳푸: 'FUK',
  유후인: 'FUK',
  쿠로가와: 'FUK',
  삿포로: 'CTS',
  오키나와: 'OKA',
  방콕: 'BKK',
  치앙마이: 'CNX',
  싱가포르: 'SIN',
  마카오: 'MAC',
  홍콩: 'HKG',
  대만: 'TPE',
  타이페이: 'TPE',
  호치민: 'SGN',
  하노이: 'HAN',
  다낭: 'DAD',
  나트랑: 'CXR',
  푸꾸옥: 'PQC',
  세부: 'CEB',
  클락: 'CRK',
  마닐라: 'MNL',
  발리: 'DPS',
  쿠알라룸푸르: 'KUL',
  양곤: 'RGN',
  미얀마: 'RGN',
  장가계: 'DYG',
  원자계: 'DYG',
  봉황고성: 'DYG',
  계림: 'KWL',
  구이린: 'KWL',
  북경: 'PEK',
  베이징: 'PEK',
  상해: 'SHA',
  상하이: 'SHA',
  청두: 'CTU',
  성도: 'CTU',
  연길: 'YNJ',
  백두산: 'YNJ',
  황산: 'HFE',
  곤명: 'KMG',
  쿤밍: 'KMG',
  서안: 'XIY',
  시안: 'XIY',
  중경: 'CKG',
  충칭: 'CKG',
  우루무치: 'URC',
  청도: 'TAO',
  칭다오: 'TAO',
  호이안: 'HOI',
  보홀: 'BOH',
  보라카이: 'MPH',
  코타키나발루: 'BKI',
  가오슝: 'KHH',
  괌: 'GUM',
  사이판: 'SPN',
  하와이: 'HNL',
  두바이: 'DXB',
  아부다비: 'AUH',
  이스탄불: 'IST',
  런던: 'LHR',
  파리: 'CDG',
  모스크바: 'SVO',
};

const DEST_KEYWORDS = Object.keys(UPLOAD_DEST_CODE_MAP);
const DEST_FALLBACK_SKIP = new Set(['부산', '인천', '김해', '서울', '제주', '청주', '대구']);

export type UploadDestinationResolution = {
  destination: string | null;
  source: 'existing' | 'product_raw' | 'document_raw' | 'temp_filename' | 'unresolved';
  departureRaw: string;
  departureCode: string;
  departureRegion: string;
  destinationCode: string;
  durationDays: number;
  failures: string[];
};

export function resolveUploadCode(text: string | undefined | null, map: Record<string, string>, fallback: string): string {
  if (!text) return fallback;
  if (map[text]) return map[text];
  for (const [key, code] of Object.entries(map)) {
    if (text.includes(key)) return code;
  }
  return fallback;
}

export function inferUploadDestinationFromText(rawText: string | undefined | null): string {
  if (!rawText) return '';
  const mojibakeProfile = detectKnownMojibakeSupplierProfile(rawText);
  if (mojibakeProfile === 'joshi-golf' || mojibakeProfile === 'narita-nomori-golf') return '나리타';
  if (mojibakeProfile?.startsWith('xian-')) return '서안';
  const head = rawText.slice(0, 3000);
  const counts: Record<string, number> = {};
  for (const name of DEST_KEYWORDS) {
    if (DEST_FALLBACK_SKIP.has(name) || name.length < 2) continue;
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = head.match(re);
    if (matches?.length) counts[name] = matches.length;
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

export function extractUploadDestinationFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return DEST_KEYWORDS.find(keyword => base.includes(keyword)) ?? '';
}

export function resolveUploadDestinationAndCodes(input: {
  destination?: string | null;
  departureAirport?: string | null;
  durationDays?: number | null;
  productRawText?: string | null;
  documentRawText?: string | null;
  tempDestination?: string | null;
}): UploadDestinationResolution {
  const failures: string[] = [];
  const existingDestination = input.destination?.trim() ?? '';
  const productInferred = inferUploadDestinationFromText(input.productRawText);
  const documentInferred = inferUploadDestinationFromText(input.documentRawText);
  const tempDestination = input.tempDestination?.trim() ?? '';

  const existingDestinationCode = resolveUploadCode(existingDestination, UPLOAD_DEST_CODE_MAP, 'UNK');
  const trustedExistingDestination = existingDestination && existingDestinationCode !== 'UNK'
    ? existingDestination
    : '';

  const destination = trustedExistingDestination || productInferred || documentInferred || tempDestination || existingDestination || null;
  const source: UploadDestinationResolution['source'] =
    trustedExistingDestination ? 'existing'
      : productInferred ? 'product_raw'
        : documentInferred ? 'document_raw'
          : tempDestination ? 'temp_filename'
            : existingDestination ? 'existing'
            : 'unresolved';

  if (!destination) failures.push('destination:unresolved');

  const departureRaw = input.departureAirport?.trim() || '부산';
  const departureCode = resolveUploadCode(departureRaw, UPLOAD_REGION_CODE_MAP, 'PUS');
  const destinationCode = resolveUploadCode(destination, UPLOAD_DEST_CODE_MAP, 'UNK');
  if (destinationCode === 'UNK') failures.push(`destination_code:UNK:${destination ?? 'empty'}`);

  const durationDays = typeof input.durationDays === 'number' && input.durationDays > 0
    ? input.durationDays
    : 5;
  const departureRegion =
    Object.entries(UPLOAD_REGION_CODE_MAP).find(([, code]) => code === departureCode)?.[0]
    ?? departureRaw.split('(')[0].trim();

  return {
    destination,
    source,
    departureRaw,
    departureCode,
    departureRegion,
    destinationCode,
    durationDays,
    failures,
  };
}

export async function issueUploadInternalCode(input: {
  departureCode: string;
  supplierCode: string;
  destinationCode: string;
  durationDays: number;
}): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('generate_internal_code', {
    p_departure_code: input.departureCode,
    p_supplier_code: input.supplierCode,
    p_destination_code: input.destinationCode,
    p_duration_days: input.durationDays,
  });
  if (error) throw new Error(`internal_code 생성 실패: ${error.message}`);
  if (!data) throw new Error('internal_code RPC가 null을 반환했습니다.');
  return data as string;
}
