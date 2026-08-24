export interface ParsedTravelSettlementMemo {
  rawMemo: string;
  normalizedKey: string;
  memoFormat: 'canonical' | 'separator_variant';
  departureDate: string;
  leadCustomerName: string;
  landOperatorName: string;
  purposeTags: TravelSettlementPurposeTag[];
}

export type TravelSettlementPurposeTag = '환불' | '취소' | '수수료' | '조정';

const TRAVEL_SETTLEMENT_PURPOSE_TAGS = new Set<TravelSettlementPurposeTag>([
  '환불',
  '취소',
  '수수료',
  '조정',
]);

export interface ParsedBankStatementRow {
  receivedAt: string;
  depositAmount: number;
  withdrawAmount: number;
  counterpartyName: string;
  memo: string;
  accountNumber?: string;
  originalLine: string;
  rowIndex: number;
  travelMemo: ParsedTravelSettlementMemo | null;
  include: boolean;
}

function normalizeToken(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, '');
}

export function normalizeSettlementMemoKey(memo: string): string {
  const parts = memo.normalize('NFKC').trim().split('_').map(normalizeToken);
  return parts.join('_');
}

export function parseTravelSettlementMemo(memo: string | null | undefined): ParsedTravelSettlementMemo | null {
  const rawMemo = (memo ?? '').normalize('NFKC').trim();
  if (!rawMemo) return null;

  let parts = rawMemo.split('_').map(part => part.trim()).filter(Boolean);
  let memoFormat: ParsedTravelSettlementMemo['memoFormat'] = 'canonical';
  if (parts.length === 2) {
    const variant = rawMemo.match(/^(\d{6})_([^_\-/|]+?)\s*[-/|]\s*(.+)$/);
    if (variant) {
      parts = [variant[1], variant[2], variant[3]];
      memoFormat = 'separator_variant';
    }
  }
  if (parts.length < 3) return null;

  const [yymmdd, customerName, ...rawOperatorParts] = parts;
  if (!/^\d{6}$/.test(yymmdd)) return null;

  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  const leadCustomerName = normalizeToken(customerName);
  const normalizedOperatorParts = rawOperatorParts.map(normalizeToken).filter(Boolean);
  const purposeTags: TravelSettlementPurposeTag[] = [];
  while (normalizedOperatorParts.length > 1) {
    const last = normalizedOperatorParts[normalizedOperatorParts.length - 1] as TravelSettlementPurposeTag;
    if (!TRAVEL_SETTLEMENT_PURPOSE_TAGS.has(last)) break;
    purposeTags.unshift(last);
    normalizedOperatorParts.pop();
  }
  const landOperatorName = normalizedOperatorParts.join('_');
  if (!leadCustomerName || !landOperatorName) return null;

  return {
    rawMemo,
    // The full provider memo remains the unique settlement key. Purpose tags
    // only change how operator identity is interpreted; they are never dropped.
    normalizedKey: normalizeSettlementMemoKey(
      `${yymmdd}_${leadCustomerName}_${[...normalizedOperatorParts, ...purposeTags].join('_')}`,
    ),
    memoFormat,
    departureDate: `${year.toString().padStart(4, '0')}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`,
    leadCustomerName,
    landOperatorName,
    purposeTags,
  };
}

function parseMoney(value: string | undefined): number {
  const cleaned = (value ?? '').normalize('NFKC').replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parseReceivedAt(value: string | undefined): string | null {
  const raw = (value ?? '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const seconds = match[3] ?? '00';
  return `${match[1]}T${match[2]}:${seconds}+09:00`;
}

function looksLikeAccount(value: string | undefined): boolean {
  return /^\d{8,}$/.test((value ?? '').replace(/\D/g, ''));
}

function parseLine(line: string, rowIndex: number): ParsedBankStatementRow | null {
  const cells = line.split('\t').map(cell => cell.trim());
  const receivedAt = parseReceivedAt(cells[0]);
  if (!receivedAt) return null;

  let accountNumber: string | undefined;
  let counterpartyName = '';
  let memo = '';
  let depositAmount = 0;
  let withdrawAmount = 0;

  if (looksLikeAccount(cells[1]) && cells.length >= 5) {
    accountNumber = cells[1].replace(/\D/g, '');
    counterpartyName = cells[3] ?? '';
    const signedAmount = parseMoney(cells[4]);
    if (signedAmount >= 0) depositAmount = signedAmount;
    else withdrawAmount = Math.abs(signedAmount);
    memo = cells.slice(5).join('\t').trim();
  } else {
    depositAmount = Math.max(0, parseMoney(cells[1]));
    withdrawAmount = Math.max(0, parseMoney(cells[2]));
    counterpartyName = cells[3] ?? '';
    memo = cells.slice(4).join('\t').trim();
  }

  if (depositAmount <= 0 && withdrawAmount <= 0) return null;

  const travelMemo = parseTravelSettlementMemo(memo);
  return {
    receivedAt,
    depositAmount,
    withdrawAmount,
    counterpartyName,
    memo,
    accountNumber,
    originalLine: line,
    rowIndex,
    travelMemo,
    include: travelMemo !== null,
  };
}

export function parseBankStatementRows(text: string): ParsedBankStatementRow[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim())
    .map(({ line, index }) => parseLine(line, index))
    .filter((row): row is ParsedBankStatementRow => row !== null);
}
