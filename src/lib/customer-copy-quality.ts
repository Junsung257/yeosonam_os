export type CustomerCopyQualityIssue = {
  code: string;
  detail: string;
};

const QUALITY_RULES: Array<{ code: string; pattern: RegExp; label: string }> = [
  {
    code: 'html_entity_visible',
    pattern: /&#(?:x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/i,
    label: 'HTML 문자 코드가 고객 문구에 그대로 보입니다.',
  },
  {
    code: 'placeholder_or_mojibake',
    pattern: /\?{2,}|�|占|梨|筌|揶|獄|癰|甕|塋|Ã|Â/i,
    label: '깨진 글자 또는 placeholder가 고객 문구에 보입니다.',
  },
  {
    code: 'internal_source_copy',
    pattern: /원문 일정에는|고객 화면에서.*원문 표현|내부 검수 동선|자동 생성 설명|사진은 정확한 자료|원문에서 추출|QA 근거|검수자/i,
    label: '내부 검수나 원문 설명 문체가 고객 화면에 보입니다.',
  },
  {
    code: 'customer_forbidden_internal_terms',
    pattern: /\b(?:NET|OP|PAX)\b|랜드사|공급사|거래처|원가(?!계)|마진|수익|정산|송금|인폼|컨펌|수배|어드민|내부\s*확인|담당자\s*확인|대기\s*인폼|인폼\s*나가/i,
    label: '랜드사/운영자용 내부 용어가 고객 문구에 보입니다.',
  },
  {
    code: 'customer_forbidden_internal_terms',
    pattern: /\uD0C0\uC0AC\s*\uBE44\uAD50\s*\uD544\uC218|\uBE44\uAD50\s*\uD544\uC218|POINT\s*[\u2460-\u24690-9]|\uD3EC\uC778\uD2B8\s*[\u2460-\u24690-9]|\uB2E8\uB3C5\s*\uD2B9\uC804/i,
    label: '내부 비교/프로모션 메모가 고객 문구에 노출됩니다.',
  },
  {
    code: 'stale_generic_recommendation',
    pattern: /처음 방문해도 부담 없이|같은 일정 사진|관광\s*행사,\s*이동도 매끄럽게/i,
    label: '범용 추천 문구가 반복됩니다.',
  },
  {
    code: 'raw_supplier_shorthand',
    pattern: /\bR\s*M\s*K\b|\bRMK\b|쇼\s+핑|\\\d{1,3}(?:,\d{3})+|(^|[^A-Za-z])P\.?\s*P\.?(?=$|[^A-Za-z])/i,
    label: '랜드사 원문 약어 또는 정리되지 않은 표기가 보입니다.',
  },
  {
    code: 'awkward_spacing_or_customer_copy',
    pattern: /불\s+포\s*함|포\s+함\s*사\s*항|추가\s+됩니다|지불\s+하셔야|부탁\s+드립니다|월기준|기사가이드\s*경비/i,
    label: '불필요한 띄어쓰기 또는 어색한 고객 문구가 보입니다.',
  },
  {
    code: 'dangling_separator',
    pattern: /(?:\s*[-–—|/]\s*)+$/,
    label: '문장 끝에 남은 구분자가 보입니다.',
  },
];

export function decodeCustomerHtmlEntities(value: string | null | undefined): string {
  let text = String(value ?? '');
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;|&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
        const code = Number.parseInt(hex, 16);
        return code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code);
      })
      .replace(/&#(\d+);/g, (_, decimal: string) => {
        const code = Number.parseInt(decimal, 10);
        return code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code);
      });
    if (text === before) break;
  }
  return text;
}

export function normalizeCustomerVisibleCopy(value: string | null | undefined): string {
  let text = decodeCustomerHtmlEntities(value)
    .replace(/\bR\s*M\s*K\b/gi, '참고사항')
    .replace(/\bRMK\b/gi, '참고사항')
    .replace(/(^|[^A-Za-z])P\.?\s*P\.?(?=$|[^A-Za-z])/gi, '$11인')
    .replace(/쇼\s+핑/g, '쇼핑')
    .replace(/불\s+포\s*함/g, '불포함')
    .replace(/포\s+함\s*사\s*항/g, '포함사항')
    .replace(/추가\s+됩니다/g, '추가됩니다')
    .replace(/지불\s+하셔야/g, '지불하셔야')
    .replace(/부탁\s+드립니다/g, '부탁드립니다')
    .replace(/예약\s+시/g, '예약 시')
    .replace(/월기준/g, '월 기준')
    .replace(/기사가이드\s*경비/g, '가이드/기사 경비')
    .replace(/바나산\s*정산/g, '바나산 정상')
    .replace(/([가-힣])\s*OR\s*([가-힣])/gi, '$1 또는 $2')
    .replace(/\\(?=\d{1,3}(?:,\d{3})+)/g, ' ')
    .replace(/(?:\s*[-–—|/]\s*)+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '미정') text = '동급 호텔 예정';
  return text;
}

export function customerCopyQualityIssues(value: string | null | undefined): CustomerCopyQualityIssue[] {
  const rawText = String(value ?? '');
  const text = decodeCustomerHtmlEntities(value);
  if (!rawText.trim() && !text.trim()) return [];
  return QUALITY_RULES
    .filter(rule => rule.pattern.test(rawText) || rule.pattern.test(text))
    .map(rule => ({ code: rule.code, detail: rule.label }));
}

export function hasCustomerCopyQualityIssues(value: string | null | undefined): boolean {
  return customerCopyQualityIssues(value).length > 0;
}
