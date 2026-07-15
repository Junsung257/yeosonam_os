const CUSTOMER_AIRLINE_CODE_TO_NAME: Record<string, string> = {
  BX: '에어부산',
  LJ: '진에어',
  '7C': '제주항공',
  TW: '티웨이항공',
  VJ: '비엣젯항공',
  ZE: '이스타항공',
  KE: '대한항공',
  OZ: '아시아나항공',
  RS: '에어서울',
  VN: '베트남항공',
  UO: '홍콩익스프레스',
  MU: '중국동방항공',
  CZ: '중국남방항공',
  SC: '산동항공',
  CA: '중국국제항공',
  QV: '라오항공',
  D7: '에어아시아X',
  '5J': '세부퍼시픽항공',
  JL: '일본항공',
  NH: '전일본공수',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function customerAirlineDisplayName(value: string | null | undefined): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const existingName = Object.values(CUSTOMER_AIRLINE_CODE_TO_NAME)
    .find(name => text.includes(name));
  if (existingName) return existingName;

  const code = text.toUpperCase().match(/^(?:항공|이용항공)?\s*([A-Z]{2}|\d[A-Z])(?:\s|$|\(|\[)/)?.[1]
    ?? text.toUpperCase().match(/^([A-Z]{2}|\d[A-Z])\d{2,4}$/)?.[1];
  return code ? CUSTOMER_AIRLINE_CODE_TO_NAME[code] ?? null : null;
}

export function normalizeCustomerAirlineCodeCopy(value: string | null | undefined): string {
  let text = String(value ?? '');
  if (!text) return '';

  for (const [code, name] of Object.entries(CUSTOMER_AIRLINE_CODE_TO_NAME)) {
    const escapedCode = escapeRegExp(code);
    text = text
      .replace(new RegExp(`(?<![A-Z0-9])${escapedCode}\\s*(?:항공)?\\s*(?:이용|탑승)(?![A-Z0-9])`, 'gi'), `${name} 이용`)
      .replace(new RegExp(`(?<![A-Z0-9])${escapedCode}\\s*항공(?![A-Z0-9])`, 'gi'), name)
      .replace(new RegExp(`\\[\\s*${escapedCode}\\s*\\]`, 'gi'), name)
      .replace(new RegExp(`(?<![A-Z0-9])${escapedCode}(?!\\d|[A-Z0-9])`, 'gi'), name);
  }

  return text.replace(/\s+/g, ' ').trim();
}
