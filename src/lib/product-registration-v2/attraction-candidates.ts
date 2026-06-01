import { extractAttractionCandidates } from '@/lib/itinerary-attraction-candidates';

const NOISE_EXACT = new Set([
  '부산', '연길', '도문', '용정', '이도백하', '북파', '서파', '전용차량', '전일',
  '호텔식', '현지식', '김밥', '김 밥', '냉면', '꿔바로우', '삼겹살', '샤브샤브',
  '양꼬치', '비빔밥', '매운탕', '무제한', '공항', '호텔', '쇼핑센터',
]);

const NOISE_PATTERN =
  /(?:공항\s*(?:미팅|이동)|호텔\s*(?:투숙|휴식|조식)|(?:출발|도착|이동|소요)$|^\d{1,2}:\d{2}$|^[A-Z0-9]{2}\d{3,4}$|^\$?\d+|선발제외일|가격표|등급|상품명)/;

export function extractCustomerAttractionCandidatesV2(activity: string, note?: string | null): string[] {
  return extractAttractionCandidates(activity, note).filter(candidate => {
    const compact = candidate.replace(/\s+/g, '');
    if (!compact) return false;
    if (NOISE_EXACT.has(candidate) || NOISE_EXACT.has(compact)) return false;
    if (NOISE_PATTERN.test(candidate)) return false;
    return true;
  });
}
