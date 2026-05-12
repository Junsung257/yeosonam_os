/**
 * @file constants/regions.ts
 * @description 지역 관련 상수 SSoT — 3곳에서 동일하게 정의되던 중복 제거.
 *
 * 이전:
 *   - package-schema.ts: RegionEnum (Zod enum)
 *   - itinerary-render.ts: REGION_ALIAS (Record)
 *   - package-acl.ts: REGION_INFERENCE (Record)
 * 이후: 이 파일 하나에서 정의, 나머지는 import.
 */

/** 지원 지역 목록 (RegionEnum의 기반 배열) */
export const REGION_LIST = [
  '말레이시아', '싱가포르', '태국', '베트남', '대만', '일본',
  '중국', '라오스', '몽골', '필리핀', '인도네시아',
] as const;

export type RegionName = typeof REGION_LIST[number];

/**
 * 지역 키워드 → 정규 지역명 매핑
 * 선택관광 이름에서 region 자동 추론할 때 사용.
 * 새 지역/도시 추가 시 여기에만 추가하면 전체 적용.
 */
export const REGION_KEYWORD_MAP: Record<string, RegionName> = {
  '말레이시아': '말레이시아', '쿠알라': '말레이시아', '말라카': '말레이시아', '겐팅': '말레이시아',
  '싱가포르': '싱가포르',
  '태국': '태국', '방콕': '태국', '파타야': '태국', '푸켓': '태국',
  '베트남': '베트남', '다낭': '베트남', '하노이': '베트남', '나트랑': '베트남',
  '대만': '대만', '타이페이': '대만', '타이베이': '대만',
  '일본': '일본', '후쿠오카': '일본', '오사카': '일본', '홋카이도': '일본',
  '중국': '중국', '서안': '중국', '북경': '중국', '상해': '중국', '장가계': '중국', '칭다오': '중국',
  '라오스': '라오스', '몽골': '몽골',
  '필리핀': '필리핀', '보홀': '필리핀', '세부': '필리핀',
  '인도네시아': '인도네시아', '발리': '인도네시아',
};
