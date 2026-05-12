/**
 * 밴드 게시글 AI 분석 공통 모듈
 * band-rss cron + scan-text API 두 경로 모두 이 모듈을 사용합니다.
 */

import OpenAI from 'openai';
import { getSecret } from '@/lib/secret-registry';

export const DEST_MAP: Record<string, string> = {
  마카오: 'MAC', 홍콩: 'HKG',
  방콕: 'BKK', 태국: 'BKK',
  싱가포르: 'SIN',
  발리: 'DPS', 인도네시아: 'DPS',
  도쿄: 'TYO', 오사카: 'OSA', 일본: 'TYO', 후쿠오카: 'FUK', 삿포로: 'CTS',
  다낭: 'DAD', 하노이: 'HAN', 호치민: 'SGN', 나트랑: 'CXR', 베트남: 'HAN',
  세부: 'CEB', 마닐라: 'MNL', 필리핀: 'MNL', 보라카이: 'MNL',
  괌: 'GUM', 사이판: 'SPN', 하와이: 'HNL',
  파리: 'PAR', 프랑스: 'PAR', 이탈리아: 'ROM', 로마: 'ROM',
  스페인: 'MAD', 터키: 'IST', 이스탄불: 'IST', 두바이: 'DXB',
  대만: 'TPE', 타이페이: 'TPE', 타이베이: 'TPE',
  베이징: 'BJS', 중국: 'BJS', 상하이: 'SHA',
  서안: 'XIY', 장가계: 'DYG', 계림: 'KWL', 곤명: 'KMG', 청두: 'CTU',
  몰디브: 'MLE', 스리랑카: 'CMB', 인도: 'DEL',
};

export const REGION_MAP: Record<string, string> = {
  부산: 'PUS', 김해: 'PUS',
  인천: 'ICN', 서울: 'ICN',
  김포: 'GMP', 제주: 'CJU',
  대구: 'TAE', 광주: 'KWJ', 청주: 'CJJ', 무안: 'MWX',
};

export const DEFAULT_MARGIN_RATE = 0.10;
export const BAND_SUPPLIER_CODE = 'BAND';

const DEST_ENTRIES   = Object.entries(DEST_MAP);
const REGION_ENTRIES = Object.entries(REGION_MAP);

export interface AIExtracted {
  destination: string;
  destination_code: string;
  departure_region: string;
  departure_region_code: string;
  duration_days: number;
  display_name: string;
  net_price: number | null;
  departure_date: string | null;
  ai_tags: string[];
}

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  const key = getSecret('DEEPSEEK_API_KEY');
  if (!key) throw new Error('DEEPSEEK_API_KEY 미설정');
  if (!_client) _client = new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' });
  return _client;
}

function applyCodeFallbacks(parsed: AIExtracted): void {
  if (!parsed.destination_code || parsed.destination_code.length !== 3) {
    for (const [k, code] of DEST_ENTRIES) {
      if (parsed.destination?.includes(k)) { parsed.destination_code = code; break; }
    }
  }
  if (!parsed.departure_region_code || parsed.departure_region_code.length !== 3) {
    for (const [k, code] of REGION_ENTRIES) {
      if (parsed.departure_region?.includes(k)) { parsed.departure_region_code = code; break; }
    }
    if (!parsed.departure_region_code) parsed.departure_region_code = 'ICN';
  }
}

/**
 * 밴드/SNS 게시글 텍스트에서 여행 상품 정보를 AI로 추출합니다.
 * 여행 상품이 아닌 경우 null을 반환합니다.
 */
export async function analyzeFromText(text: string): Promise<AIExtracted | null> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content: `당신은 여행사 마케팅 게시글 분석 전문가입니다.
밴드/SNS 게시글에서 여행 상품 정보를 추출하여 순수 JSON으로만 응답하세요.
여행 상품이 아닌 게시글이면 {"not_product":true}를 반환하세요.

규칙:
- destination_code: IATA 도시코드 3자리 대문자
- departure_region_code: 출발 공항코드 3자리
- duration_days: 여행 총 일수 숫자만 (3박5일→5)
- net_price: 원가/판매가 원화 정수. 없으면 null
- departure_date: 가장 빠른 출발일 YYYY-MM-DD. 없으면 null
- ai_tags: 특징 태그 배열 (예: ["노팁노옵션","소규모","실속"])`,
      },
      {
        role: 'user',
        content: `게시글 내용:\n${text.slice(0, 4000)}\n\n아래 JSON으로 추출:\n{"destination":"","destination_code":"","departure_region":"","departure_region_code":"","duration_days":0,"display_name":"","net_price":null,"departure_date":null,"ai_tags":[]}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(
    response.choices?.[0]?.message?.content ?? '{}'
  ) as AIExtracted & { not_product?: boolean };

  if (parsed.not_product) return null;
  if (!parsed.duration_days || parsed.duration_days < 1) return null;

  applyCodeFallbacks(parsed);
  return parsed;
}
