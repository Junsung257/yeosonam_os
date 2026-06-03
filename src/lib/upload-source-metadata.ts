export type UploadSourceMetadataSource =
  | 'explicit'
  | 'source_label'
  | 'filename'
  | 'raw_text'
  | 'default';

export interface UploadSourceMetadataIssue {
  code: string;
  message: string;
  severity: 'error' | 'review';
}

export interface UploadSourceMetadataInput {
  rawText?: string | null;
  sourceLabel?: string | null;
  fileName?: string | null;
  explicitLandOperator?: string | null;
  explicitCommissionRate?: number | string | null;
  defaultCommissionRate?: number;
}

export interface UploadSourceMetadataResult {
  landOperator?: string;
  commissionRate: number;
  marginRate: number;
  cleanSourceLabel: string;
  parserRawText?: string;
  metadataOnlyLineRemoved: boolean;
  source: UploadSourceMetadataSource;
  issues: UploadSourceMetadataIssue[];
}

interface MetadataCandidate {
  landOperator?: string;
  commissionRate?: number;
  cleanSourceLabel?: string;
  metadataOnly: boolean;
}

const DEFAULT_COMMISSION_RATE = 10;
const MAX_COMMISSION_RATE = 50;

function compact(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function stripExtension(value: string): string {
  return value.replace(/\.[A-Za-z0-9]{1,8}$/, '').trim();
}

function parseRate(value: number | string | null | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validateRate(rate: number | undefined, source: UploadSourceMetadataSource): UploadSourceMetadataIssue[] {
  if (rate == null) return [];
  if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_COMMISSION_RATE) {
    return [{
      code: 'commission_rate_out_of_range',
      message: `Commission rate must be greater than 0 and at most ${MAX_COMMISSION_RATE}%. Received: ${rate}`,
      severity: source === 'explicit' ? 'error' : 'review',
    }];
  }
  return [];
}

function parseMetadataCandidate(value: string | null | undefined, fromRawLine = false): MetadataCandidate | null {
  const original = compact(stripExtension(value ?? ''));
  if (!original) return null;

  const bracket = original.match(/^\[([^_\]\n]{2,40})_(\d+(?:\.\d+)?)%?\]\s*(.*?)$/);
  if (bracket) {
    const clean = compact(bracket[3]);
    return {
      landOperator: compact(bracket[1]),
      commissionRate: parseRate(bracket[2]),
      cleanSourceLabel: clean || undefined,
      metadataOnly: fromRawLine ? clean.length === 0 : false,
    };
  }

  const simple = original.match(/^(.{2,40}?)\s+(\d+(?:\.\d+)?)%$/u);
  if (simple) {
    return {
      landOperator: compact(simple[1]),
      commissionRate: parseRate(simple[2]),
      metadataOnly: fromRawLine,
    };
  }

  const rate = original.match(/(?:^|[_\s-])(\d+(?:\.\d+)?)%(?:$|[_\s-])/);
  if (!rate) return null;

  const beforeRate = compact(original.slice(0, rate.index).replace(/[[\]_-]+/g, ' '));
  const afterRate = compact(original.slice((rate.index ?? 0) + rate[0].length).replace(/[[\]_-]+/g, ' '));
  const tokens = beforeRate.split(/\s+/).filter(Boolean);
  const landOperator = tokens[0];
  if (!landOperator || landOperator.length < 2) return null;

  const cleanTokens = [...tokens.slice(1), afterRate].map(compact).filter(Boolean);
  return {
    landOperator,
    commissionRate: parseRate(rate[1]),
    cleanSourceLabel: cleanTokens.join(' ') || undefined,
    metadataOnly: fromRawLine && cleanTokens.length === 0,
  };
}

function findRawTextMetadata(rawText: string | null | undefined): {
  candidate: MetadataCandidate | null;
  parserRawText?: string;
  removed: boolean;
} {
  if (!rawText) return { candidate: null, parserRawText: rawText ?? undefined, removed: false };

  const lines = rawText.split(/\r?\n/);
  let nonEmptySeen = 0;
  for (let i = 0; i < lines.length && nonEmptySeen < 3; i++) {
    if (!lines[i].trim()) continue;
    nonEmptySeen++;
    const candidate = parseMetadataCandidate(lines[i], true);
    if (!candidate) continue;
    if (!candidate.metadataOnly) return { candidate, parserRawText: rawText, removed: false };

    const stripped = lines.filter((_, idx) => idx !== i).join('\n').replace(/^\s+/, '');
    return { candidate, parserRawText: stripped, removed: true };
  }

  return { candidate: null, parserRawText: rawText, removed: false };
}

export function parseUploadSourceMetadata(input: UploadSourceMetadataInput): UploadSourceMetadataResult {
  const defaultCommissionRate = input.defaultCommissionRate ?? DEFAULT_COMMISSION_RATE;
  const explicitRate = parseRate(input.explicitCommissionRate);
  const rawMetadata = findRawTextMetadata(input.rawText);
  const sourceLabelCandidate = parseMetadataCandidate(input.sourceLabel);
  const filenameCandidate = parseMetadataCandidate(input.fileName);

  const explicitLandOperator = compact(input.explicitLandOperator);
  let source: UploadSourceMetadataSource = 'default';
  let landOperator: string | undefined;
  let commissionRate: number | undefined;
  let cleanSourceLabel =
    sourceLabelCandidate?.cleanSourceLabel
    ?? filenameCandidate?.cleanSourceLabel
    ?? compact(stripExtension(input.sourceLabel ?? input.fileName ?? 'text-input.txt'));

  if (explicitLandOperator || explicitRate != null) {
    source = 'explicit';
    landOperator = explicitLandOperator || sourceLabelCandidate?.landOperator || filenameCandidate?.landOperator || rawMetadata.candidate?.landOperator;
    commissionRate = explicitRate ?? sourceLabelCandidate?.commissionRate ?? filenameCandidate?.commissionRate ?? rawMetadata.candidate?.commissionRate;
  } else if (sourceLabelCandidate?.landOperator || sourceLabelCandidate?.commissionRate != null) {
    source = 'source_label';
    landOperator = sourceLabelCandidate.landOperator;
    commissionRate = sourceLabelCandidate.commissionRate;
    cleanSourceLabel = sourceLabelCandidate.cleanSourceLabel ?? cleanSourceLabel;
  } else if (filenameCandidate?.landOperator || filenameCandidate?.commissionRate != null) {
    source = 'filename';
    landOperator = filenameCandidate.landOperator;
    commissionRate = filenameCandidate.commissionRate;
    cleanSourceLabel = filenameCandidate.cleanSourceLabel ?? cleanSourceLabel;
  } else if (rawMetadata.candidate?.landOperator || rawMetadata.candidate?.commissionRate != null) {
    source = 'raw_text';
    landOperator = rawMetadata.candidate.landOperator;
    commissionRate = rawMetadata.candidate.commissionRate;
    cleanSourceLabel = rawMetadata.candidate.cleanSourceLabel ?? cleanSourceLabel;
  }

  const issues = [
    ...validateRate(explicitRate, 'explicit'),
    ...validateRate(sourceLabelCandidate?.commissionRate, 'source_label'),
    ...validateRate(filenameCandidate?.commissionRate, 'filename'),
    ...validateRate(rawMetadata.candidate?.commissionRate, 'raw_text'),
  ];

  const finalCommissionRate = commissionRate ?? defaultCommissionRate;
  issues.push(...validateRate(finalCommissionRate, source));

  return {
    landOperator,
    commissionRate: finalCommissionRate,
    marginRate: finalCommissionRate / 100,
    cleanSourceLabel: cleanSourceLabel || 'text-input.txt',
    parserRawText: rawMetadata.parserRawText,
    metadataOnlyLineRemoved: rawMetadata.removed,
    source,
    issues,
  };
}
