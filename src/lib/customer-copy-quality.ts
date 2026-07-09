export type CustomerCopyQualityIssue = {
  code: string;
  detail: string;
};

const HANGUL_WORD = '[가-힣A-Za-z0-9·.,&()/\\-\\s]';

const QUALITY_RULES: Array<{ code: string; pattern: RegExp; label: string }> = [
  {
    code: 'html_entity_visible',
    pattern: /&#(?:x[0-9a-f]+|\d+);?|&(amp|lt|gt|quot|apos);/i,
    label: 'HTML 문자 코드가 고객 문구에 그대로 보입니다.',
  },
  {
    code: 'placeholder_or_mojibake',
    pattern: /�|占|锟|ï¿½|\?{2,}/i,
    label: '깨진 글자 또는 placeholder가 고객 문구에 보입니다.',
  },
  {
    code: 'internal_source_copy',
    pattern: /원문\s*일정|고객\s*화면.*원문|자동\s*생성\s*설명|사진은\s*정확한\s*자료|원문에서\s*추출|QA\s*근거|검수자|operator|internal/i,
    label: '내부 검수나 원문 설명 문체가 고객 화면에 보입니다.',
  },
  {
    code: 'customer_forbidden_internal_terms',
    pattern: /\b(?:NET|OP|PAX)\b|랜드사\s*공급가|거래처\s*단가|상품\s*원가|마진|수익|컴프|커펌|배분|어드민\s*담당자\s*확인|대기\s*입금|입금\s*확인|(?:거래처|랜드사|마진).{0,12}정산|정산\s*(?:메모|요청|확인)/i,
    label: '랜드사/운영자용 내부 용어가 고객 문구에 보입니다.',
  },
  {
    code: 'customer_forbidden_internal_terms',
    pattern: /관리\s*비공개\s*필수|비공개\s*필수|POINT\s*[0-9]|포인트\s*[0-9]|단독\s*특전/i,
    label: '내부 비공개/프로모션 메모가 고객 문구에 노출됩니다.',
  },
  {
    code: 'raw_supplier_shorthand',
    pattern: /\bR\s*M\s*K\b|\bRMK\b|\\\s*\d{1,3}(?:,\d{3})+|(^|[^A-Za-z])P\.?\s*P\.?(?=$|[^A-Za-z])/i,
    label: '랜드사 원문 약어 또는 정리되지 않은 표기가 보입니다.',
  },
  {
    code: 'supplier_notation',
    pattern: /\bTAX\s*\(\s*\d{1,2}\s*월\s*기준\s*\)|유류할증료\s*\(\s*\d{1,2}\s*월\s*기준\s*\)|\d{1,2}\s*월기준|\d{1,2}\s*월\s*(?:선발|발권|선발권\s*기준\s*요금)|기사가이드경비|기사\s*가이드\s*경비|\[\s*[A-Z0-9]{2,3}\s+[^\]]*?PKG\s*\]|(^|[\s📍])\[?[A-Z0-9]{2,3}\]\s*(?=[가-힣])|[☑✔ώ]|✓(?=\S)|(?<=\S)✓|[가-힣]+\s*OR\s*[가-힣]+|[가-힣]+\s*or\s*[가-힣]+|바나산\s*정산|맥주\s*OR\s*음료/i,
    label: '랜드사식 표기 또는 고객에게 어색한 원문 표기가 보입니다.',
  },
  {
    code: 'raw_filename_or_hash_title',
    pattern: /^[0-9a-f]{8,}-|투어비[_\s]|_[가-힣]|[가-힣]_|선발가|\(\s*\d{3,4}\s*발권\s*\)|\b\d{4}_\d{4}\b/i,
    label: '파일명, 해시, 발권 코드처럼 보이는 원문 제목이 고객 문구에 보입니다.',
  },
  {
    code: 'awkward_spacing_or_customer_copy',
    pattern: /월기준|기사가이드경비|추가\s+합니다|지불\s+하셔야|부\s+담\s+됩\s+니다/i,
    label: '불완전한 띄어쓰기 또는 어색한 고객 문구가 보입니다.',
  },
  {
    code: 'generic_marketing_fallback',
    pattern: /아름다운\s*시간|여행의\s*피로를\s*풀어(?:봅니다|주는|줄)|처음\s*방문해도\s*부담\s*없이|같은\s*일정\s*사진|관광\s*행사,\s*이동도\s*매끄럽게/i,
    label: '반복적인 범용 마케팅 fallback 문구가 고객 화면에 보입니다.',
  },
  {
    code: 'low_information_action_sentence',
    pattern: new RegExp(`^[\\s"'\\[\\](){}<>]*${HANGUL_WORD}{1,24}(?:로|으로)?\\s*(?:갑니다|방문합니다|이동합니다)[\\s.!?]*$`, 'iu'),
    label: '정보량이 낮은 동작형 문장이 고객 일정 문구에 보입니다.',
  },
  {
    code: 'incomplete_or_noisy_sentence',
    pattern: /^\s*\/|\.{2,}|(?:발생합니다|포함하여|변경됨)\s*$/i,
    label: '선행 구분자, 중복 마침표, 끝이 잘린 문장이 보입니다.',
  },
  {
    code: 'dangling_separator',
    pattern: /(?:\s*[-–—]\s*)+$/,
    label: '문장 끝에 남은 구분자가 보입니다.',
  },
];

export function decodeCustomerHtmlEntities(value: string | null | undefined): string {
  let text = String(value ?? '').replace(/&#974(?!\d|;)/g, '');
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;|&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => {
        const code = Number.parseInt(hex, 16);
        return code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code);
      })
      .replace(/&#(\d+);?/g, (_, decimal: string) => {
        const code = Number.parseInt(decimal, 10);
        return code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code);
      });
    if (text === before) break;
  }
  return text;
}

function normalizeLowInformationSentence(text: string): string {
  return text
    .replace(/^([가-힣A-Za-z0-9·.,&()/\-\s]{1,24}?)(?:으로|로)?\s*방문합니다\.?$/iu, '$1 방문')
    .replace(/^([가-힣A-Za-z0-9·.,&()/\-\s]{1,24}?)(?:으로|로)?\s*이동합니다\.?$/iu, '$1 이동')
    .replace(/^([가-힣A-Za-z0-9·.,&()/\-\s]{1,24}?)\s*갑니다\.?$/iu, '$1 이동');
}

function normalizeKoreanAlternatives(text: string): string {
  let normalized = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const before = normalized;
    normalized = normalized.replace(/([가-힣]+)\s*or\s*([가-힣]+)/gi, '$1 또는 $2');
    if (normalized === before) break;
  }
  return normalized;
}

export function normalizeCustomerVisibleCopy(value: string | null | undefined): string {
  const decoded = decodeCustomerHtmlEntities(value)
    .replace(/^[0-9a-f]{8,}-/i, '')
    .replace(/^\s*\d{1,2}\s*월\s*(?:선발|발권)\s*/g, '')
    .replace(/[“"]?\s*\d{1,2}\s*월\s*선발권\s*기준\s*요금입니다\.?\s*[”"]?/g, '')
    .replace(/\[\s*[A-Z0-9]{2,3}\s+([^\]]*?)\s*PKG\s*\]/gi, '$1')
    .replace(/(^|[\s📍])\[?[A-Z0-9]{2,3}\]\s*(?=[가-힣])/gu, '$1')
    .replace(/^\s*\[?[A-Z0-9]{2,3}\]\s*(?=[가-힣])/u, '')
    .replace(/_/g, ' ')
    .replace(/투어비\s*/g, '')
    .replace(/선발가/g, '')
    .replace(/\(\s*\d{3,4}\s*발권\s*\)/g, '')
    .replace(/\b\d{4}\s+\d{4}\b/g, '')
    .replace(/\s*[☑✓✔ώ]\s*/gu, ' ')
    .replace(/\bR\s*M\s*K\b/gi, '참고사항')
    .replace(/\bRMK\b/gi, '참고사항')
    .replace(/(^|[^A-Za-z])P\.?\s*P\.?(?=$|[^A-Za-z])/gi, '$11인')
    .replace(/\\\s*(\d{1,3}(?:,\d{3})+)(?!\s*원)/g, '$1원')
    .replace(/\bTAX\s*\(\s*(\d{1,2})\s*월\s*기준\s*\)/gi, '항공세 $1월 기준')
    .replace(/유류할증료\s*\(\s*(\d{1,2})\s*월\s*기준\s*\)/g, '유류할증료 $1월 기준')
    .replace(/(\d{1,2})\s*월기준/g, '$1월 기준')
    .replace(/기사가이드경비|기사\s*가이드\s*경비/g, '가이드/기사 경비')
    .replace(/바나산\s*정산/g, '바나산 정상')
    .replace(/맥주\s*OR\s*음료/gi, '맥주 또는 음료')
    .replace(/^경우가\s*종종\s*발생합니다\.?$/g, '')
    .replace(/추가\s+합니다/g, '추가합니다')
    .replace(/지불\s+하셔야/g, '지불하셔야')
    .replace(/마사지\s*(\d+\s*시간)?(?:으로)?\s*여행의\s*피로를\s*풀어(?:봅니다|주는|줄 수 있습니다)\.?/g, (_, duration: string | undefined) => (
      duration ? `마사지 ${duration.replace(/\s+/g, '')}` : '마사지'
    ))
    .replace(/여행의\s*피로를\s*풀어(?:봅니다|주는|줄 수 있습니다)\.?/g, '휴식');

  return normalizeLowInformationSentence(normalizeKoreanAlternatives(decoded))
    .replace(/([가-힣A-Za-z0-9·]{2,20})\s+\1(?=\s|[.!?,)]|$)/g, '$1')
    .replace(/^\s*\/+\s*/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/(?:\s*[-–—]\s*)+$/g, '')
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
