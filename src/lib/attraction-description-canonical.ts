/**
 * High-confidence supplier-description → existing canonical-name hints.
 *
 * These hints never create or mutate attraction masters. Callers must still
 * resolve the returned label to one customer-publishable existing master.
 */
export const HIGH_CONFIDENCE_ATTRACTION_DESCRIPTION_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/성바울\s*성당|세인트\s*폴\s*성당/i, '성바울성당유적'],
  [/세나도\s*광장/i, '세나도 광장'],
  [/육포\s*(?:&|및|과)\s*쿠키\s*거리|육포쿠키거리/i, '육포및쿠키거리'],
  [/빅토리아\s*피크/i, '빅토리아피크'],
  [/소인국(?:\s*민속촌)?/i, '소인국테마파크'],
  [/악화\s*쌍폭포/i, '악화폭포'],
  [/(?:35|36|37)\s*호\s*경계비.*천지\s*조망/i, '백두산 천지'],
  [/보천\s*대협곡|황룡담.*(?:함주|구련폭포)/i, '보천풍경구'],
  [/팔천협(?:\s*관광|\s*협곡)?/i, '팔천협풍경구'],
  [/다국적\s*와인의\s*역사.*와인\s*박물관/i, '장유 와인박물관'],
];

export function inferHighConfidenceAttractionLabels(...texts: Array<string | null | undefined>): string[] {
  const labels = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const [pattern, label] of HIGH_CONFIDENCE_ATTRACTION_DESCRIPTION_LABELS) {
      if (pattern.test(text)) labels.add(label);
    }
  }
  return [...labels];
}
