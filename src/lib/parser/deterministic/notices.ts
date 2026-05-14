/**
 * @file deterministic/notices.ts — notices_parsed 4-type 결정적 분류 (2026-05-14 박제)
 *
 * 박제 사유:
 *   Cross-validation 룰 C3 (CRITICAL/PAYMENT/POLICY/INFO 4-type 모두 필요) 가 매번 실패하던 사고.
 *   LLM 이 4 타입 분류를 자주 빼먹는데, 카탈로그 REMARK/비고/특이사항/주의사항 영역의 키워드만
 *   봐도 결정적으로 분류 가능. 한국 여행사 카탈로그 표준 어휘.
 *
 * 분류:
 *   - CRITICAL: 취소/환불/여권/쇼핑/연령제한 — 고객에게 가장 중요한 제약
 *   - PAYMENT: 추가요금/할증/싱글차지/유류세/공항이용료 — 돈
 *   - POLICY:  현장규정/팁/매너/지각/단독행동/주류반입 — 현지 규칙
 *   - INFO:    출입국/이동시간/시차/통화/날씨/유심 — 안내 정보
 *
 * 빈 카테고리는 standard-terms fallback 으로 자동 채워짐 (C39).
 */

export interface NoticeItem {
  type: 'CRITICAL' | 'PAYMENT' | 'POLICY' | 'INFO';
  title: string;
  text: string;
}

const KEYWORD_TO_TYPE: Array<{ kw: RegExp; type: NoticeItem['type'] }> = [
  // CRITICAL — 고객 의무·계약 핵심
  { kw: /취소|환불|위약|벌금|패널티|탑승\s*거부/, type: 'CRITICAL' },
  { kw: /여권|비자|만료|6개월|입국\s*불가|반입\s*금지/, type: 'CRITICAL' },
  { kw: /쇼핑(센터)?(\s*\d+회)?|쇼핑\s*없음|면세점/, type: 'CRITICAL' },
  { kw: /연령\s*제한|미성년|만\s*\d+세\s*이상/, type: 'CRITICAL' },
  // PAYMENT — 돈
  { kw: /추가\s*요금|할증|써차지|surcharge|싱글\s*차지|발권/, type: 'PAYMENT' },
  { kw: /유류세|공항\s*이용료|관광세|시(\s)?티택스|호텔세/, type: 'PAYMENT' },
  { kw: /기사\s*팁|가이드\s*팁|매너\s*팁|선장\s*팁|기내식\s*비용/, type: 'PAYMENT' },
  // POLICY — 현지 규정·매너
  { kw: /지각|단독\s*행동|개별\s*행동|이탈|불참|미참여/, type: 'POLICY' },
  { kw: /흡연|음주|주류|반입|복장|드레스\s*코드/, type: 'POLICY' },
  { kw: /가이드\s*지시|일정\s*변경|차량\s*통제/, type: 'POLICY' },
  // INFO — 일반 안내
  { kw: /출입국|입국\s*수속|세관|면세\s*한도/, type: 'INFO' },
  { kw: /시차|통화|환전|날씨|기후|기온/, type: 'INFO' },
  { kw: /유심|와이파이|로밍|콘센트|전압/, type: 'INFO' },
  { kw: /이동\s*시간|소요\s*시간|차량|버스/, type: 'INFO' },
];

const TITLE_BY_TYPE: Record<NoticeItem['type'], string> = {
  CRITICAL: '필수 확인 사항',
  PAYMENT: '추가 비용 안내',
  POLICY: '현지 규정 및 매너',
  INFO: '여행 준비 안내',
};

/**
 * 본문에서 REMARK/비고/특이사항/주의사항 섹션의 문장을 추출해 4-type 으로 분류.
 * 매칭된 문장은 type 별 bucket 에 추가, "• " 불릿 형식으로 합쳐 text 생성.
 */
export function extractNotices(rawText: string): NoticeItem[] {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const buckets: Record<NoticeItem['type'], string[]> = {
    CRITICAL: [],
    PAYMENT: [],
    POLICY: [],
    INFO: [],
  };

  for (const line of lines) {
    // 너무 짧으면 (≤8자) skip
    if (line.length < 8 || line.length > 300) continue;
    // 불릿 prefix 제거 후 분류 시도
    const cleaned = line.replace(/^[▶●•·◆◇■□★☆+\-○•▪●◦]+\s*/, '').trim();
    if (cleaned.length < 8) continue;

    for (const { kw, type } of KEYWORD_TO_TYPE) {
      if (kw.test(cleaned)) {
        // 동일 type bucket 에 중복 라인 방지
        if (!buckets[type].some(x => x.includes(cleaned.slice(0, 30)))) {
          buckets[type].push(cleaned);
        }
        break; // 첫 매칭된 type 으로만 분류 (KEYWORD 우선순위 = 작성 순서)
      }
    }
  }

  const out: NoticeItem[] = [];
  (['CRITICAL', 'PAYMENT', 'POLICY', 'INFO'] as const).forEach(type => {
    const items = buckets[type];
    if (items.length > 0) {
      out.push({
        type,
        title: TITLE_BY_TYPE[type],
        text: items.map(x => `• ${x}`).join('\n'),
      });
    }
  });

  return out;
}
