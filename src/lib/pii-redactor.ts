/**
 * PII Redactor — 한국 컨텍스트(전화·여권·계좌·이름) 마스킹.
 *
 * 원칙:
 *   - LLM에 raw 텍스트 보내기 *전에* 무조건 통과시킴.
 *   - false negative 위험을 줄이려고 정규식 기반 (확실한 패턴) + name list 기반 (대화 문맥에서 발견된 이름) 이중 적용.
 *   - 결과는 placeholder로 치환 ([PHONE], [NAME], [PASSPORT], [ACCOUNT]) — 의미는 보존.
 *
 * 한계: 이름 NER는 외부 모델 없이 규칙 기반만 — 카톡 메시지의 "이름이 010-..." 패턴에서 자동 추출. 그 외 이름은 미보장.
 */

export interface RedactionReport {
  phones_masked: number;
  names_masked: number;
  passports_masked: number;
  accounts_masked: number;
  emails_masked: number;
  resident_ids_masked: number;
  detected_names: string[];
}

export interface RedactionResult {
  redacted: string;
  report: RedactionReport;
}

const PHONE_RE = /\b0?1[016789][- ]?\d{3,4}[- ]?\d{4}\b|\b0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}\b/g;
const PASSPORT_RE = /\b[MR]\d{8}\b/g;
const ACCOUNT_RE = /\b\d{2,6}[- ]\d{2,6}[- ]\d{2,8}\b|\b\d{10,14}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const RESIDENT_ID_RE = /\b\d{6}[- ]?[1-4]\d{6}\b/g;
const NAME_NEAR_PHONE_RE = /([가-힣]{2,4})\s*(?=0?1[016789][- ]?\d{3,4}[- ]?\d{4})/g;
const NAME_AFTER_PHONE_RE = /(?<=0?1[016789][- ]?\d{3,4}[- ]?\d{4}\s*)([가-힣]{2,4})/g;
const PHONE_DASH_NAME_RE = /(\d{3,4}[- ]?\d{4})\s*([가-힣]{2,4})\b/g;

const NAME_BLACKLIST = new Set([
  '안녕', '감사', '죄송', '확인', '문의', '예약', '계약', '발권', '취소', '결제',
  '입금', '잔금', '안내', '준비', '도착', '출발', '여행', '호텔', '항공', '공항',
  '미팅', '확정', '여소남', '오픈라이프', '신한', '국민', '우리', '농협', '카카오',
]);

function maskString(input: string, re: RegExp, placeholder: string): { out: string; count: number } {
  let count = 0;
  const out = input.replace(re, () => {
    count += 1;
    return placeholder;
  });
  return { out, count };
}

export function redactKoreanPII(input: string): RedactionResult {
  const detected_names = new Set<string>();
  for (const match of input.matchAll(NAME_NEAR_PHONE_RE)) {
    if (match[1] && !NAME_BLACKLIST.has(match[1])) detected_names.add(match[1]);
  }
  for (const match of input.matchAll(NAME_AFTER_PHONE_RE)) {
    if (match[1] && !NAME_BLACKLIST.has(match[1])) detected_names.add(match[1]);
  }
  for (const match of input.matchAll(PHONE_DASH_NAME_RE)) {
    if (match[2] && !NAME_BLACKLIST.has(match[2])) detected_names.add(match[2]);
  }

  let working = input;

  const passports = maskString(working, PASSPORT_RE, '[PASSPORT]');
  working = passports.out;
  const residents = maskString(working, RESIDENT_ID_RE, '[RESIDENT_ID]');
  working = residents.out;
  const phones = maskString(working, PHONE_RE, '[PHONE]');
  working = phones.out;
  const accounts = maskString(working, ACCOUNT_RE, '[ACCOUNT]');
  working = accounts.out;
  const emails = maskString(working, EMAIL_RE, '[EMAIL]');
  working = emails.out;

  let names_masked = 0;
  for (const name of detected_names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'g');
    const before = working;
    working = working.replace(re, '[NAME]');
    names_masked += (before.match(re) || []).length;
  }

  return {
    redacted: working,
    report: {
      phones_masked: phones.count,
      names_masked,
      passports_masked: passports.count,
      accounts_masked: accounts.count,
      emails_masked: emails.count,
      resident_ids_masked: residents.count,
      detected_names: Array.from(detected_names),
    },
  };
}
