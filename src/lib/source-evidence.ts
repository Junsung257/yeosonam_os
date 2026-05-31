import crypto from 'crypto';

export type SourceEvidenceKind = 'raw' | 'deterministic' | 'standard_terms' | 'manual';

export type SourceEvidenceSpan = {
  rawTextHash: string;
  start: number;
  end: number;
  quote: string;
  confidence: number;
  source: SourceEvidenceKind;
};

export type SourceEvidenceMap = Record<string, SourceEvidenceSpan[]>;

export const REQUIRED_PACKAGE_EVIDENCE_FIELDS = [
  'meta.region',
  'meta.tripStyle',
  'meta.minParticipants',
  'meta.airline',
  'flights.outbound[0].code',
  'flights.inbound[0].code',
  'priceGroups[0].adultPrice',
] as const;

export const MIN_PACKAGE_EVIDENCE_COVERAGE = 0.85;

export function hashRawText(rawText: string): string {
  return crypto.createHash('sha256').update(rawText).digest('hex');
}

function normalizeNeedles(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const text = String(value).trim();
  if (!text || text === '?' || text === '--:--') return [];
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = value;
    const values = new Set<string>();
    if (n > 0 && n < 100) {
      values.add(`${n}명`);
      values.add(`${n} 명`);
    }
    values.add(n.toLocaleString('ko-KR'));
    values.add(text);
    return [...values].filter(Boolean);
  }
  const values = new Set<string>([text]);
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) {
      if (n > 0 && n < 100) {
        values.add(`${n}명`);
        values.add(`${n} 명`);
      }
      values.add(n.toLocaleString('ko-KR'));
    }
  }
  return [...values].filter(Boolean);
}

export function findEvidenceSpan(
  rawText: string,
  value: unknown,
  options: { rawTextHash?: string; source?: SourceEvidenceKind; confidence?: number } = {},
): SourceEvidenceSpan | null {
  const needles = normalizeNeedles(value);
  if (!rawText || needles.length === 0) return null;
  for (const needle of needles) {
    const idx = rawText.indexOf(needle);
    if (idx < 0) continue;
    return {
      rawTextHash: options.rawTextHash ?? hashRawText(rawText),
      start: idx,
      end: idx + needle.length,
      quote: rawText.slice(idx, idx + needle.length),
      confidence: options.confidence ?? 1,
      source: options.source ?? 'raw',
    };
  }
  return null;
}

export function collectEvidenceForValues(
  rawText: string,
  entries: Array<[string, unknown]>,
  options: { rawTextHash?: string } = {},
): SourceEvidenceMap {
  const rawTextHash = options.rawTextHash ?? hashRawText(rawText);
  const out: SourceEvidenceMap = {};
  for (const [field, value] of entries) {
    const span = findEvidenceSpan(rawText, value, { rawTextHash });
    if (span) out[field] = [span];
  }
  return out;
}

export function evidenceCoverage(
  evidence: SourceEvidenceMap | null | undefined,
  requiredFields: string[],
): { total: number; covered: number; missing: string[]; ratio: number } {
  const ev = evidence ?? {};
  const missing = requiredFields.filter(field => !Array.isArray(ev[field]) || ev[field].length === 0);
  const total = requiredFields.length;
  const covered = total - missing.length;
  return {
    total,
    covered,
    missing,
    ratio: total === 0 ? 1 : covered / total,
  };
}
