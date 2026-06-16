/**
 * slug 유틸리티 — 한글→영문 로마자 변환 및 slug 정규화
 *
 * SSOT: 세 slug 맵(DEST_ROMAN, romanize(), toEnglishSlug)을 하나로 통합.
 * 새 목적지 추가 시 이 파일만 수정하면 모든 경로에 반영된다.
 */

// 주요 목적지 한글→영문 로마자 매핑
const ROMAN_MAP: Record<string, string> = {
  // 베트남
  '다낭': 'danang', '호이안': 'hoian', '나트랑': 'nhatrang', '달랏': 'dalat',
  '판랑': 'phanrang', '하노이': 'hanoi', '호치민': 'hcmc', '호찌민': 'hochiminh',
  '푸꾸옥': 'phuquoc', '무이네': 'muine', '사파': 'sapa', '하롱베이': 'halongbay',
  // 태국
  '방콕': 'bangkok', '푸켓': 'phuket', '치앙마이': 'chiangmai', '파타야': 'pattaya',
  '끄라비': 'krabi', '치앙라이': 'chiangrai', '코사무이': 'samui', '코창': 'kohchang',
  '화힌': 'hua_hin', '피피': 'phiphi',
  // 일본
  '도쿄': 'tokyo', '오사카': 'osaka', '후쿠오카': 'fukuoka', '삿포로': 'sapporo',
  '북해도': 'hokkaido', '나가사키': 'nagasaki', '오키나와': 'okinawa',
  '교토': 'kyoto', '고베': 'kobe', '나고야': 'nagoya',
  '나하': 'naha', '가고시마': 'kagoshima', '유후인': 'yufuin', '벳부': 'beppu',
  '시즈오카': 'shizuoka', '아소': 'aso', '쿠로가와': 'kurokawa', '시모노세키': 'shimonoseki',
  // 중국
  '베이징': 'beijing', '상하이': 'shanghai', '칭다오': 'qingdao', '청도': 'qingdao',
  '하얼빈': 'harbin', '서안': 'xian', '장가계': 'zhangjiajie', '황산': 'huangshan',
  '호화호특': 'hohhot', '후허하오터': 'hohhot', '석가장': 'shijiazhuang',
  '계림': 'guilin', '양삭': 'yangshuo', '북경': 'beijing', '상해': 'shanghai',
  // 대만
  '타이베이': 'taipei', '타이중': 'taichung', '가오슝': 'kaohsiung',
  '타이난': 'tainan', '화롄': 'hualien',
  // 필리핀
  '세부': 'cebu', '보라카이': 'boracay', '보홀': 'bohol', '마닐라': 'manila',
  '팔라완': 'palawan', '엘니도': 'elnido', '일로일로': 'iloilo', '두마게테': 'dumaguete',
  // 인도네시아
  '발리': 'bali', '자카르타': 'jakarta', '요그야카르타': 'yogyakarta', '롬복': 'lombok',
  // 싱가포르/말레이시아
  '싱가포르': 'singapore', '말라카': 'malacca', '쿠알라룸푸르': 'kualalumpur',
  '코타키나발루': 'kotakinabalu', '페낭': 'penang',
  // 홍콩/마카오
  '홍콩': 'hongkong', '마카오': 'macau',
  // 몽골
  '몽골': 'mongolia', '울란바토르': 'ulaanbaatar',
  '비엔티엔': 'vientiane', '루앙프라방': 'luangprabang', '방비엥': 'vangvieng',
  // 미국/괌
  '괌': 'guam', '사이판': 'saipan', '하와이': 'hawaii',
  '캐나다': 'canada',
  // 유럽
  '파리': 'paris', '런던': 'london', '로마': 'rome', '바르셀로나': 'barcelona',
  '프라하': 'prague', '부다페스트': 'budapest', '빈': 'vienna',
  // 한국
  '부산': 'busan', '서울': 'seoul', '제주': 'jeju', '인천': 'incheon',
};

const ROMAN_MAP_EXTRA: Record<string, string> = {
  '\uD074\uB77D': 'clark',
  '\uC720\uB7FD': 'europe',
  '\uC2DC\uB4DC\uB2C8': 'sydney',
  '\uD638\uC8FC': 'australia',
  '\uC5F0\uAE38': 'yanji',
  '\uBC31\uB450\uC0B0': 'baekdusan',
  '\uC5F0\uAE38/\uBC31\uB450\uC0B0': 'yanji-baekdusan',
};

const TOPIC_TERM_MAP: Array<[RegExp, string]> = [
  [/여행\s*준비물\s*완벽\s*체크리스트|준비물\s*완벽\s*체크리스트|여행\s*준비물|준비물|체크리스트/g, ' preparation '],
  [/월별\s*날씨와\s*옷차림|월별\s*날씨|날씨와\s*옷차림|날씨|옷차림|기온/g, ' weather '],
  [/화폐\s*환전\s*팁\s*문화|화폐|환전|팁\s*문화/g, ' currency '],
  [/여행\s*완벽\s*가이드|완벽\s*가이드/g, ' complete guide '],
  [/추천\s*일정|일정|코스/g, ' itinerary '],
  [/비자|입국\s*서류|입국/g, ' visa '],
  [/예상\s*총비용|총비용|절약\s*팁|비용/g, ' budget '],
  [/현지\s*맛집|맛집|음식|미식/g, ' food '],
  [/교통수단|교통|이동\s*방법/g, ' transport '],
  [/자주\s*묻는\s*질문|질문|FAQ/gi, ' faq '],
];

/**
 * topic 문자열에서 가장 가능성 높은 destination 토큰 추출.
 * slug-utils SSOT — generate/route.ts 와 blog-publisher 공유.
 */
const KNOWN_DESTINATIONS = [
  '나트랑','다낭','호치민','하노이','푸꾸옥','달랏','하롱베이','사파',
  '오사카','도쿄','교토','후쿠오카','큐슈','북해도','삿포로','오키나와','시즈오카',
  '아소','쿠로가와','시모노세키',
  '장가계','서안','상해','북경','청도','칭다오','연길','구채구',
  '방콕','치앙마이','푸켓','파타야','발리','코타키나발루','쿠알라룸푸르','싱가포르',
  '세부','보홀','마닐라','마카오','홍콩','타이베이','울란바토르','테를지',
  '제주','부산','경주','파리','로마','이스탄불','프라하',
  '호화호특','후허하오터','석가장','보라카이','팔라완','나하',
  '벳부','유후인','계림','양삭',
];
export function extractDestination(topic: string): string {
  for (const dest of KNOWN_DESTINATIONS) {
    if (topic.includes(dest)) return dest;
  }
  return topic.split(/\s+/)[0] || topic;
}

/** 목적지명을 영문 slug로 변환 (다낭→danang, 다낭/호이안→danang-hoian) */
export function romanize(dest: string): string {
  const parts = dest.split(/[\/\s,]+/).filter(Boolean);
  const romanParts = parts.map(p => ROMAN_MAP[p] || ROMAN_MAP_EXTRA[p] || null).filter(Boolean);
  if (romanParts.length > 0) return romanParts.join('-');
  // 매핑 실패 시 알파벳/숫자만 유지 (한글 제거)
  return dest.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** 토픽(문장)을 안전한 영문 slug로 변환 — 모든 목적지명 로마자 변환 */
export function slugifyTopic(topic: string): string {
  // 1) 모든 목적지명을 순차 치환
  let slug = topic.toLowerCase();
  // ROMAN_MAP 엔트리를 긴 키부터 정렬 (부분 매칭 방지: "보라카이"가 "보라"보다 우선)
  const sorted = Object.entries({ ...ROMAN_MAP, ...ROMAN_MAP_EXTRA }).sort((a, b) => b[0].length - a[0].length);
  for (const [kr, en] of sorted) {
    slug = slug.replace(new RegExp(kr, 'g'), en);
  }
  for (const [pattern, en] of TOPIC_TERM_MAP) {
    slug = slug.replace(pattern, en);
  }
  // 2) 남은 한글/특수문자는 단어 경계를 보존하도록 하이픈으로 치환
  //    예: "시모노세키/후쿠오카/벳부 준비물" → "shimonoseki-fukuoka-beppu-preparation"
  slug = slug
    .replace(/[^a-z0-9\s-]/g, '-')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-(preparation|currency|weather|visa|budget|food|faq|itinerary|transport|guide)(?:-\1)+(?=-|$)/g, '-$1')
    .replace(/^-|-$/g, '')
    .substring(0, 80)
    .replace(/-+$/, '');
  if (slug.length >= 3) return slug;

  // 3) 그래도 짧은 slug면(예: 숫자만 남은 "6") topic 앞부분 내용을 fallback 해시로 보강
  const fallbackHash = topic
    .replace(/[^a-zA-Z가-힣0-9]/g, '')
    .substring(0, 10)
    .toLowerCase()
    .replace(/[가-힣]/g, '')
    .trim();
  const suffix = fallbackHash.length >= 2 ? fallbackHash : `post-${Date.now().toString(36).slice(-4)}`;
  return `${slug}-${suffix}`.replace(/^-|-$/g, '').substring(0, 80);

  // 4) 어떤 목적지도 매칭되지 않은 경우 — 한글 완전 제거 (거의 도달하지 않음)
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80)
    .replace(/-+$/, '');
}
