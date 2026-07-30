export const ATTRACTION_OWNER_REVIEW_CSV_HEADERS = [
  'name',
  'short_desc',
  'long_desc',
  'country',
  'region',
  'badge_type',
  'emoji',
  'aliases',
  'official_source_url',
  'supporting_source_urls',
  'source_phrases',
  'verification_method',
  'evidence_summary',
  'owner_reviewed',
] as const;

export const ATTRACTION_IDENTITY_VERIFICATION_METHODS = [
  'official_source_review',
  'official_and_supplier_crosscheck',
  'official_and_supplier_image_crosscheck',
  'owner_direct_confirmation',
] as const;

export type AttractionIdentityVerificationMethod =
  typeof ATTRACTION_IDENTITY_VERIFICATION_METHODS[number];

export type AttractionOwnerReviewCsvItem = {
  name: string;
  short_desc: string;
  long_desc: string | null;
  country: string;
  region: string;
  badge_type: string;
  emoji: string;
  aliases: string[];
  official_source_url: string | null;
  supporting_source_urls: string[];
  source_phrases: string[];
  verification_method: AttractionIdentityVerificationMethod | null;
  evidence_summary: string | null;
  owner_reviewed: boolean;
};

export type AttractionOwnerReviewCsvParseResult = {
  items: AttractionOwnerReviewCsvItem[];
  rejectedRows: Array<{ row: number; reason: string; name: string | null }>;
  legacyFormat: boolean;
  hasOwnerReviewedColumn: boolean;
};

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (inQuotes && csv[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && csv[index + 1] === '\n') index += 1;
      row.push(current);
      current = '';
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else {
      current += character;
    }
  }

  row.push(current);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase();
}

function headerIndex(headers: string[], name: string): number {
  return headers.indexOf(name);
}

function cell(row: string[], headers: string[], name: string): string {
  const index = headerIndex(headers, name);
  return index >= 0 ? String(row[index] ?? '').trim() : '';
}

export function normalizeOwnerReviewAliases(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[|;\n]/)
      : [];
  const unique = new Set<string>();
  for (const rawValue of rawValues) {
    const alias = String(rawValue ?? '').replace(/\s+/g, ' ').trim();
    if (alias) unique.add(alias);
  }
  return [...unique];
}

export function isOwnerReviewedValue(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['yes', 'y', 'true', '1', '승인', '검수완료', '확인'].includes(normalized);
}

export function normalizeOfficialSourceUrl(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeOfficialSourceUrls(value: unknown): {
  urls: string[];
  invalidValues: string[];
} {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[|;\n]/)
      : [];
  const urls = new Set<string>();
  const invalidValues: string[] = [];
  for (const rawValue of rawValues) {
    const text = String(rawValue ?? '').trim();
    if (!text) continue;
    const normalized = normalizeOfficialSourceUrl(text);
    if (normalized) urls.add(normalized);
    else invalidValues.push(text);
  }
  return { urls: [...urls], invalidValues };
}

export function normalizeIdentityVerificationMethod(
  value: unknown,
): AttractionIdentityVerificationMethod | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return (ATTRACTION_IDENTITY_VERIFICATION_METHODS as readonly string[]).includes(normalized)
    ? normalized as AttractionIdentityVerificationMethod
    : null;
}

export function parseAttractionOwnerReviewCsv(csv: string): AttractionOwnerReviewCsvParseResult {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) {
    return {
      items: [],
      rejectedRows: [{ row: 1, reason: 'CSV가 비어 있습니다.', name: null }],
      legacyFormat: false,
      hasOwnerReviewedColumn: false,
    };
  }

  const headers = rows[0].map(normalizeHeader);
  const hasOwnerReviewedColumn = headers.includes('owner_reviewed');
  const legacyFormat = !hasOwnerReviewedColumn;
  const items: AttractionOwnerReviewCsvItem[] = [];
  const rejectedRows: AttractionOwnerReviewCsvParseResult['rejectedRows'] = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const name = cell(row, headers, 'name');
    if (!name) {
      rejectedRows.push({ row: rowNumber, reason: '관광지명이 없습니다.', name: null });
      return;
    }

    const rawOfficialUrl = cell(row, headers, 'official_source_url');
    const officialSourceUrl = normalizeOfficialSourceUrl(rawOfficialUrl);
    if (rawOfficialUrl && !officialSourceUrl) {
      rejectedRows.push({ row: rowNumber, reason: '공식 근거 URL이 올바른 http(s) 주소가 아닙니다.', name });
      return;
    }
    const rawSupportingUrls = cell(row, headers, 'supporting_source_urls');
    const supportingUrls = normalizeOfficialSourceUrls(rawSupportingUrls);
    if (supportingUrls.invalidValues.length > 0) {
      rejectedRows.push({
        row: rowNumber,
        reason: `보조 근거 URL이 올바른 http(s) 주소가 아닙니다: ${supportingUrls.invalidValues[0]}`,
        name,
      });
      return;
    }
    const rawVerificationMethod = cell(row, headers, 'verification_method');
    const verificationMethod = normalizeIdentityVerificationMethod(rawVerificationMethod);
    if (rawVerificationMethod && !verificationMethod) {
      rejectedRows.push({
        row: rowNumber,
        reason: `지원하지 않는 검증 방식입니다: ${rawVerificationMethod}`,
        name,
      });
      return;
    }

    items.push({
      name,
      short_desc: cell(row, headers, 'short_desc'),
      long_desc: cell(row, headers, 'long_desc') || null,
      country: cell(row, headers, 'country'),
      region: cell(row, headers, 'region'),
      badge_type: cell(row, headers, 'badge_type') || 'tour',
      emoji: cell(row, headers, 'emoji'),
      aliases: normalizeOwnerReviewAliases(cell(row, headers, 'aliases')),
      official_source_url: officialSourceUrl,
      supporting_source_urls: supportingUrls.urls
        .filter(url => url !== officialSourceUrl),
      source_phrases: normalizeOwnerReviewAliases(cell(row, headers, 'source_phrases')),
      verification_method: verificationMethod,
      evidence_summary: cell(row, headers, 'evidence_summary') || null,
      owner_reviewed: hasOwnerReviewedColumn
        ? isOwnerReviewedValue(cell(row, headers, 'owner_reviewed'))
        : false,
    });
  });

  return {
    items,
    rejectedRows,
    legacyFormat,
    hasOwnerReviewedColumn,
  };
}

function escapeCsvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildAttractionOwnerReviewCsv(
  items: AttractionOwnerReviewCsvItem[],
): string {
  const header = ATTRACTION_OWNER_REVIEW_CSV_HEADERS.join(',');
  const rows = items.map(item => [
    item.name,
    item.short_desc,
    item.long_desc ?? '',
    item.country,
    item.region,
    item.badge_type,
    item.emoji,
    item.aliases,
    item.official_source_url ?? '',
    item.supporting_source_urls,
    item.source_phrases,
    item.verification_method ?? '',
    item.evidence_summary ?? '',
    item.owner_reviewed ? 'yes' : 'no',
  ].map(escapeCsvCell).join(','));
  return `\uFEFF${header}\n${rows.join('\n')}\n`;
}

export function mergeOwnerReviewedAliases(
  existing: unknown,
  reviewed: unknown,
): string[] {
  return normalizeOwnerReviewAliases([
    ...normalizeOwnerReviewAliases(existing),
    ...normalizeOwnerReviewAliases(reviewed),
  ]);
}

export function mergeOfficialVerificationSources(
  existing: unknown,
  officialSourceUrl: string | null,
  supportingSourceUrls: string[] = [],
  evidence?: {
    verificationMethod?: AttractionIdentityVerificationMethod | null;
    evidenceSummary?: string | null;
  },
): Array<Record<string, unknown>> {
  const current = Array.isArray(existing)
    ? existing.filter((source): source is Record<string, unknown> =>
      Boolean(source) && typeof source === 'object' && !Array.isArray(source)
    )
    : [];
  const next = [...current];
  const candidates = [
    ...(officialSourceUrl ? [{ kind: 'official_url', url: officialSourceUrl }] : []),
    ...normalizeOfficialSourceUrls(supportingSourceUrls).urls.map(url => ({
      kind: 'supporting_url',
      url,
    })),
  ];
  for (const candidate of candidates) {
    const evidenceMetadata = {
      review_channel: 'admin_csv_owner_confirmed',
      ...(evidence?.verificationMethod
        ? { verification_method: evidence.verificationMethod }
        : {}),
      ...(evidence?.evidenceSummary
        ? { evidence_summary: evidence.evidenceSummary }
        : {}),
    };
    const existingIndex = next.findIndex(source => source.url === candidate.url);
    if (existingIndex >= 0) {
      next[existingIndex] = {
        ...next[existingIndex],
        ...evidenceMetadata,
      };
      continue;
    }
    next.push({
      ...candidate,
      ...evidenceMetadata,
    });
  }
  return next;
}
