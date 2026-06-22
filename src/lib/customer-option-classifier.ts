const MONEY_RE = /(?:\$\s*\d+(?:\.\d+)?|\d[\d,]*\s*(?:원|KRW|동|VND)|USD\s*\d+(?:\.\d+)?)/i;
const TOUR_KEYWORD_RE =
  /(?:선택\s*관광|현지\s*지불\s*옵션|현지지불옵션|강력\s*추천\s*옵션|추천\s*옵션|옵션\s*투어|호핑|투어|마사지|스파|쇼|공연|크루즈|체험|입장권|티켓|케이블카|워터파크|온천|5D|VIP|식사|삼겹살|불고기|양꼬치|송이구이|파라세일링|씨워크|다이빙|parasailling|parasailing|seawalk|diving|massage|spa|show|cruise|ticket|tour)/i;
const NON_OPTION_FEE_RE =
  /(?:가이드|기사|경비|팁|tip|매너팁|마사지\s*팁|캐디\s*팁|캐디팁|캐디피|그린피|카트비|싱글\s*카트|싱글카트|싱글\s*차지|싱글차지|써차지|서차지|surcharge|유류|비자|여권|전자담배|패널티|벌금|공항세|텍스|tax|룸\s*타입|객실|호텔\s*예약|갈라디너|주말\s*플레이|국경일|휴장|티오프|티업|라운딩\s*순서|골프장\s*선택|골프장\s*정보|코스\s*정보|미팅\/?샌딩|송영차량비|차량비|단독차량|현장\s*결제)/i;
const CATALOG_NOISE_RE =
  /^(?:기\s*간|상\s*품\s*가|룸\s*타\s*입|인\s*원|포\s*함|불\s*포\s*함|포함\s*사항|불포함\s*사항|비\s*고|R\s*M\s*K|REMARK|쇼핑\s*센터|쇼핑|출\s*발\s*일|판매\s*가|요금표|---)$/i;
const NO_OPTION_RE = /(?:노\s*옵션|no\s*option|선택\s*관광\s*(?:없음|무|0\s*회))/i;
const SHOPPING_DISCLOSURE_RE = /(?:노\s*쇼핑|쇼핑\s*센터|쇼핑\s*\d+\s*회|쇼핑\d+회)/i;

function clean(value: string): string {
  return value
    .replace(/^[\s▶●•·◆◇■□★☆+\-♣∎※△]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isNonCustomerOptionText(value: string | null | undefined): boolean {
  const text = clean(String(value ?? ''));
  if (!text) return true;
  const compact = text.replace(/\s+/g, '');
  if (CATALOG_NOISE_RE.test(text) || CATALOG_NOISE_RE.test(compact)) return true;
  if (NO_OPTION_RE.test(text)) return true;
  if (SHOPPING_DISCLOSURE_RE.test(text) && !/선택|옵션|현지지불/i.test(text)) return true;
  if (NON_OPTION_FEE_RE.test(text)) return true;
  if (/\d{1,2}[/-]\d{1,2}.*발권/.test(text)) return true;
  if (/^\d{1,2}[/-]\d{1,2}(?:,\s*\d{1,2})*$/.test(compact)) return true;
  if (/^\d{1,3}$/.test(compact) || /^\d[\d,]*원?$/.test(compact)) return true;
  return false;
}

export function isCustomerOptionalTourCandidate(value: string | null | undefined): boolean {
  const text = clean(String(value ?? ''));
  if (!text || isNonCustomerOptionText(text)) return false;
  const hasMoney = MONEY_RE.test(text);
  if (!TOUR_KEYWORD_RE.test(text)) return false;
  if (hasMoney) return true;
  return /(?:현지\s*지불\s*옵션|현지지불옵션|강력\s*추천\s*옵션|추천\s*옵션|선택\s*관광)/i.test(text)
    && !NO_OPTION_RE.test(text);
}
