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
  // 중국
  '베이징': 'beijing', '상하이': 'shanghai', '칭다오': 'qingdao', '청도': 'qingdao',
  '하얼빈': 'harbin', '서안': 'xian', '장가계': 'zhangjiajie', '황산': 'huangshan',
  '호화호특': 'hohhot', '후허하오터': 'hohhot', '석가장': 'shijiazhuang',
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
  // 미국/괌
  '괌': 'guam', '사이판': 'saipan', '하와이': 'hawaii',
  '캐나다': 'canada',
  // 유럽
  '파리': 'paris', '런던': 'london', '로마': 'rome', '바르셀로나': 'barcelona',
  '프라하': 'prague', '부다페스트': 'budapest', '빈': 'vienna',
  // 한국
  '부산': 'busan', '서울': 'seoul', '제주': 'jeju', '인천': 'incheon',
};

/** 목적지명을 영문 slug로 변환 (다낭→danang, 다낭/호이안→danang-hoian) */
export function romanize(dest: string): string {
  const parts = dest.split(/[\/\s,]+/).filter(Boolean);
  const romanParts = parts.map(p => ROMAN_MAP[p] || null).filter(Boolean);
  if (romanParts.length > 0) return romanParts.join('-');
  // 매핑 실패 시 알파벳/숫자만 유지 (한글 제거)
  return dest.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** 토픽(문장)을 안전한 영문 slug로 변환 — 모든 목적지명 로마자 변환 */
export function slugifyTopic(topic: string): string {
  // 1) 모든 목적지명을 순차 치환
  let slug = topic.toLowerCase();
  // ROMAN_MAP 엔트리를 긴 키부터 정렬 (부분 매칭 방지: "보라카이"가 "보라"보다 우선)
  const sorted = Object.entries(ROMAN_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [kr, en] of sorted) {
    slug = slug.replace(new RegExp(kr, 'g'), en);
  }
  // 2) 남은 한글/특수문자 제거
  slug = slug
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80)
    .replace(/-+$/, '');
  if (slug.length >= 3) return slug;

  // 3) 어떤 목적지도 매칭되지 않은 경우 — 한글 완전 제거
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
