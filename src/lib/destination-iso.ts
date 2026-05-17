/**
 * destination(한글 도시명) → ISO2 country code SSOT (2026-05-15)
 *
 * 사장님 비전: "키워드 박으면 자동 매칭" — page.tsx fetch OR clause / lp-hero-resolver /
 * upload pipeline 어디서나 동일한 매핑 사용. DB trigger fn_attractions_normalize 와 짝.
 *
 * 갱신 규칙: 새 destination 등록 시 매핑에 한 줄 추가. ISO2 코드 유지 (ISO 3166-1 alpha-2).
 */

export const KOREAN_DESTINATION_TO_ISO: Readonly<Record<string, string>> = Object.freeze({
  // 베트남 VN
  '나트랑': 'VN', '다낭': 'VN', '하노이': 'VN', '호치민': 'VN', '푸꾸옥': 'VN',
  '달랏': 'VN', '하롱베이': 'VN', '호이안': 'VN', '판랑': 'VN', '캄란': 'VN',
  '닌빈': 'VN', '베트남': 'VN',
  // 일본 JP
  '오사카': 'JP', '도쿄': 'JP', '후쿠오카': 'JP', '삿포로': 'JP', '오키나와': 'JP',
  '교토': 'JP', '나가사키': 'JP', '북해도': 'JP', '나라': 'JP', '벳부': 'JP',
  '사가': 'JP', '아소': 'JP', '나하': 'JP', '일본': 'JP',
  '시즈오카': 'JP', '카와구치': 'JP', '카와구치코': 'JP', '이즈': 'JP', '이즈반도': 'JP',
  '미시마': 'JP', '하코네': 'JP', '센다이': 'JP', '가고시마': 'JP', '구마모토': 'JP',
  '나고야': 'JP', '히로시마': 'JP', '고베': 'JP', '요코하마': 'JP',
  // 태국 TH
  '방콕': 'TH', '치앙마이': 'TH', '푸켓': 'TH', '파타야': 'TH', '치앙라이': 'TH',
  '끄라비': 'TH', '태국': 'TH',
  // 중국 CN
  '서안': 'CN', '장가계': 'CN', '북경': 'CN', '상해': 'CN', '계림': 'CN',
  '황산': 'CN', '청두': 'CN', '연길': 'CN', '곤명': 'CN', '여강': 'CN',
  '심천': 'CN', '광저우': 'CN', '청도': 'CN', '제남': 'CN', '위해': 'CN',
  '연태': 'CN', '정주': 'CN', '도문': 'CN', '용정': 'CN', '양삭': 'CN',
  '임주': 'CN', '중국': 'CN',
  // 대만 TW
  '대만': 'TW', '타이베이': 'TW', '타이페이': 'TW', '가오슝': 'TW', '화롄': 'TW',
  '지우펀': 'TW', '예류': 'TW', '야류': 'TW', '스펀': 'TW',
  // 필리핀 PH
  '세부': 'PH', '보라카이': 'PH', '마닐라': 'PH', '보홀': 'PH', '필리핀': 'PH',
  // 인도네시아 ID
  '발리': 'ID', '자카르타': 'ID', '인도네시아': 'ID',
  // 말레이시아 MY
  '쿠알라룸푸르': 'MY', '쿠알라': 'MY', '코타키나발루': 'MY', '말라카': 'MY',
  '겐팅': 'MY', '조호바루': 'MY', '말레이시아': 'MY',
  // 싱가포르 SG / 홍콩 HK / 마카오 MO
  '싱가포르': 'SG', '센토사': 'SG',
  '홍콩': 'HK', '마카오': 'MO',
  // 그 외 아시아
  '몽골': 'MN', '울란바토르': 'MN',
  '라오스': 'LA', '비엔티엔': 'LA', '루앙프라방': 'LA', '방비엥': 'LA',
  '캄보디아': 'KH', '시엠립': 'KH',
  '미얀마': 'MM', '버마': 'MM',
  '인도': 'IN', '뉴델리': 'IN',
  '카자흐스탄': 'KZ', '알마티': 'KZ',
  '키르기스스탄': 'KG', '카라콜': 'KG',
});

/**
 * destination 한글 문자열에서 단일 ISO2 country code 추론.
 * 첫 토큰 우선, 매핑 실패 시 null.
 * upload/unmatched/auto-bootstrap 등 INSERT 경로에서 attractions.country 값 정규화용.
 *
 * 2026-05-17 박제 (ERR-shizuoka-country-destination):
 *   upload/route.ts 가 `country: firstSeedDest`(='시즈오카') 로 unmatched 적재 → 등록 시
 *   attractions.country='시즈오카'(ISO 아님) 로 박혀 page.tsx Step A OR clause 매칭 실패.
 *   본 헬퍼로 'JP' 변환 후 박아야 함. region 컬럼에 한글 destination 보존.
 */
export function inferCountryFromDestination(destination: string | null | undefined): string | null {
  if (!destination) return null;
  const tokens = destination.split(/[\/,·&\+\s]+/).map(t => t.trim()).filter(Boolean);
  for (const t of tokens) {
    const iso = KOREAN_DESTINATION_TO_ISO[t];
    if (iso) return iso;
  }
  return null;
}

/**
 * destination 한글 문자열을 도시 토큰 배열로 분해.
 *   "시즈오카" → ['시즈오카']
 *   "계림/양삭" → ['계림', '양삭']
 *   "유후인/벳부/아소 + 쿠로가와" → ['유후인', '벳부', '아소', '쿠로가와']
 *
 * 2026-05-18 박제 (ERR-social-proof-eq-mismatch):
 *   /packages/[id]/page.tsx social proof 가 raw `.eq('destination', pkg.destination)` 였음.
 *   같은 도시 다른 표기 ("다낭" vs "다낭/호이안") 패키지 인기도 합산 누락.
 *   본 헬퍼로 tokenize → 메인 토큰 ilike 매칭으로 회복.
 */
export function extractDestinationTokens(destination: string | null | undefined): string[] {
  if (!destination) return [];
  return destination.split(/[\/,·&\+\s]+/).map(t => t.trim()).filter(Boolean);
}

/**
 * destination 한글 문자열에서 ISO2 country codes 추출.
 * "나트랑/달랏" → ['VN'] (중복 제거)
 * "후쿠오카 + 오사카" → ['JP']
 */
export function destinationToIsoSet(destination: string | null | undefined): Set<string> {
  if (!destination) return new Set();
  const tokens = destination.split(/[\/,·&\+\s]+/).map(t => t.trim()).filter(Boolean);
  const out = new Set<string>();
  for (const t of tokens) {
    const iso = KOREAN_DESTINATION_TO_ISO[t];
    if (iso) out.add(iso);
  }
  return out;
}
