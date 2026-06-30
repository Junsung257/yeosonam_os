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
    pattern: /\?{2,}|�|占|筌|揶|獄|甕|疫|癰|塋|夷|횄|횂|(?:[ÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöùúûüýþÿ][^\s]{0,8}){2,}/i,
    label: '깨진 글자 또는 placeholder가 고객 문구에 보입니다.',
  },
  {
    code: 'internal_source_copy',
    pattern: /원문\s*일정|고객\s*화면.*원문|내부\s*검수|자동\s*생성\s*설명|사진은\s*정확한\s*자료|원문에서\s*추출|QA\s*근거|검수자|operator|internal/i,
    label: '내부 검수나 원문 설명 문체가 고객 화면에 보입니다.',
  },
  {
    code: 'customer_forbidden_internal_terms',
    pattern: /\b(?:NET|OP|PAX)\b|랜드사|공급가|거래처\s*원가|상품\s*원가|마진|수익|컴프|커펌|배분|어드민|담당자\s*확인|대기\s*입금|입금\s*확인|(?:거래처|랜드사|내부|마진).{0,12}정산|정산\s*(?:메모|요청|확인)/i,
    label: '랜드사/운영자용 내부 용어가 고객 문구에 보입니다.',
  },
  {
    code: 'customer_forbidden_internal_terms',
    pattern: /타사\s*비교\s*필수|비교\s*필수|POINT\s*[①-⑩0-9]|포인트\s*[①-⑩0-9]|단독\s*특전/i,
    label: '내부 비교/프로모션 메모가 고객 문구에 노출됩니다.',
  },
  {
    code: 'raw_supplier_shorthand',
    pattern: /\bR\s*M\s*K\b|\bRMK\b|\\\s*\d{1,3}(?:,\d{3})+|(^|[^A-Za-z])P\.?\s*P\.?(?=$|[^A-Za-z])/i,
    label: '랜드사 원문 약어 또는 정리되지 않은 표기가 보입니다.',
  },
  {
    code: 'supplier_notation',
    pattern: /(?:TAX|유류(?:할증료|세))\s*\(\s*\d{1,2}\s*월기준\s*\)|기사\s*가이드\s*경비|기사가이드경비|[가-힣]\s*OR\s*[가-힣]|바나산\s*정산|맥주\s*OR\s*음료/i,
    label: '랜드사식 표기 또는 고객에게 어색한 원문 표기가 보입니다.',
  },
  {
    code: 'awkward_spacing_or_customer_copy',
    pattern: /월기준|기사가이드경비|부\s+담|포\s+함\s+사\s+항|추가\s+됩니다|지불\s+하셔야|부\s+탁\s+드립니다/i,
    label: '불완전한 띄어쓰기 또는 어색한 고객 문구가 보입니다.',
  },
  {
    code: 'generic_marketing_fallback',
    pattern: /아름다운\s*시간|여행의\s*피로를\s*풀어\s*(?:줄|주는)|처음\s*방문해도\s*부담\s*없이|같은\s*일정\s*사진|관광\s*행사,\s*이동도\s*매끄럽게/i,
    label: '반복적인 범용 마케팅 fallback 문구가 고객 화면에 보입니다.',
  },
  {
    code: 'low_information_action_sentence',
    pattern: /^[\s"'\[\](){}<>]*[가-힣A-Za-z0-9·.,&()/\-\s]{1,24}(?:로|으로)?\s*(?:갑니다|방문합니다|이동합니다)[\s.!?]*$/i,
    label: '정보량이 낮은 동작형 문장이 고객 일정 문구에 보입니다.',
  },
  {
    code: 'incomplete_or_noisy_sentence',
    pattern: /^\s*\/|\.{2,}|(?:발생합니다\s*포함하여|변경될)\s*$/i,
    label: '선행 구분자, 중복 마침표, 끝이 잘린 문장이 보입니다.',
  },
  {
    code: 'dangling_separator',
    pattern: /(?:\s*[-–—/]\s*)+$/,
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
  return decodeCustomerHtmlEntities(value)
    .replace(/\bR\s*M\s*K\b/gi, '참고사항')
    .replace(/\bRMK\b/gi, '참고사항')
    .replace(/(^|[^A-Za-z])P\.?\s*P\.?(?=$|[^A-Za-z])/gi, '$11인')
    .replace(/부\s+담/g, '부담')
    .replace(/포\s+함\s+사\s+항/g, '포함사항')
    .replace(/추가\s+됩니다/g, '추가됩니다')
    .replace(/지불\s+하셔야/g, '지불하셔야')
    .replace(/부\s+탁\s+드립니다/g, '부탁드립니다')
    .replace(/예약\s+전/g, '예약 전')
    .replace(/월기준/g, '월 기준')
    .replace(/(\d{1,2})\s*월\s*기준/g, '$1월 기준')
    .replace(/기사\s*가이드\s*경비|기사가이드경비/g, '가이드/기사 경비')
    .replace(/바나산\s*정산/g, '바나산 정상')
    .replace(/([가-힣])\s*OR\s*([가-힣])/gi, '$1 또는 $2')
    .replace(/여행의\s*피로를\s*풀어\s*(?:줄|주는)\s*/g, '')
    .replace(/^\s*\/+\s*/g, '')
    .replace(/^([가-힣A-Za-z0-9·.,&()/\-\s]{1,24}?)(?:으로|로)?\s*방문합니다\.?$/i, '$1 방문')
    .replace(/^([가-힣A-Za-z0-9·.,&()/\-\s]{1,24}?)(?:으로|로)\s*이동합니다\.?$/i, '$1 이동')
    .replace(/^([가-힣A-Za-z0-9·.,&()/\-\s]{1,24}?)\s*갑니다\.?$/i, '$1 이동')
    .replace(/\\\s*(\d{1,3}(?:,\d{3})+)(?!\s*원)/g, '$1원')
    .replace(/\.{2,}/g, '.')
    .replace(/(?:\s*[-–—/]\s*)+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
