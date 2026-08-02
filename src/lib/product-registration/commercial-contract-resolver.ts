import type { SupabaseClient } from '@supabase/supabase-js';

export type CommercialContractOperator = {
  id: string;
  name: string;
  aliases: string[] | null;
  is_active: boolean | null;
};

export type CommercialContractRow = {
  id: string;
  land_operator_id: string;
  contract_label: string;
  commission_rate: number | string;
  filename_markers: string[] | null;
  source_label_markers: string[] | null;
  raw_text_markers: string[] | null;
  allow_operator_alias_match: boolean | null;
  valid_from: string;
  valid_to: string | null;
  evidence_url: string | null;
  evidence_hash: string | null;
  verified_at: string;
  priority: number | null;
  land_operators: CommercialContractOperator | CommercialContractOperator[] | null;
};

export type CommercialContractResolution =
  | {
      status: 'resolved';
      contractId: string;
      landOperatorId: string;
      landOperator: string;
      commissionRate: number;
      evidence: string;
      matchedBy: 'filename_marker' | 'source_label_marker' | 'raw_text_marker' | 'operator_alias';
      matchedValue: string;
    }
  | { status: 'not_found'; reason: string }
  | { status: 'ambiguous'; reason: string; contractIds: string[] }
  | { status: 'lookup_error'; reason: string };

export type CommercialContractResolutionInput = {
  fileName?: string | null;
  sourceLabel?: string | null;
  rawText?: string | null;
  asOf?: Date;
};

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\.[A-Za-z0-9]{1,8}$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('ko-KR');
}

function operatorFrom(row: CommercialContractRow): CommercialContractOperator | null {
  const value = Array.isArray(row.land_operators) ? row.land_operators[0] : row.land_operators;
  return value && value.id && value.name ? value : null;
}

function markerMatch(haystack: string, markers: string[] | null): string | null {
  if (!haystack) return null;
  for (const marker of markers ?? []) {
    const normalizedMarker = normalize(marker);
    if (normalizedMarker.length >= 2 && haystack.includes(normalizedMarker)) return marker.trim();
  }
  return null;
}

function contractMatch(
  row: CommercialContractRow,
  input: CommercialContractResolutionInput,
): Pick<Extract<CommercialContractResolution, { status: 'resolved' }>, 'matchedBy' | 'matchedValue'> | null {
  const fileName = normalize(input.fileName);
  const sourceLabel = normalize(input.sourceLabel);
  const rawText = normalize(input.rawText);

  const filenameMarker = markerMatch(fileName, row.filename_markers);
  if (filenameMarker) return { matchedBy: 'filename_marker', matchedValue: filenameMarker };
  const sourceLabelMarker = markerMatch(sourceLabel, row.source_label_markers);
  if (sourceLabelMarker) return { matchedBy: 'source_label_marker', matchedValue: sourceLabelMarker };
  const rawTextMarker = markerMatch(rawText, row.raw_text_markers);
  if (rawTextMarker) return { matchedBy: 'raw_text_marker', matchedValue: rawTextMarker };

  if (!row.allow_operator_alias_match) return null;
  const operator = operatorFrom(row);
  if (!operator) return null;
  const aliases = [operator.name, ...(operator.aliases ?? [])].map(normalize).filter(value => value.length >= 2);
  const sources = [fileName, sourceLabel, rawText].filter(Boolean);
  const alias = aliases.find(candidate => sources.some(source => source.includes(candidate)));
  return alias ? { matchedBy: 'operator_alias', matchedValue: alias } : null;
}

function isInDate(row: CommercialContractRow, asOf: Date): boolean {
  const date = asOf.toISOString().slice(0, 10);
  return row.valid_from <= date && (!row.valid_to || row.valid_to >= date);
}

export function resolveCommercialContractFromRows(
  input: CommercialContractResolutionInput,
  rows: CommercialContractRow[],
): CommercialContractResolution {
  const asOf = input.asOf ?? new Date();
  const matches = rows
    .filter(row => isInDate(row, asOf))
    .flatMap(row => {
      const operator = operatorFrom(row);
      const match = contractMatch(row, input);
      const rate = Number(row.commission_rate);
      if (!operator || operator.is_active === false || !match || !Number.isFinite(rate) || rate <= 0 || rate > 50) return [];
      return [{ row, operator, match, rate, priority: Number(row.priority ?? 100) }];
    })
    .sort((left, right) => right.priority - left.priority);

  if (matches.length === 0) {
    return { status: 'not_found', reason: 'verified commercial contract marker not found' };
  }

  const highestPriority = matches[0].priority;
  const winners = matches.filter(match => match.priority === highestPriority);
  const distinctValues = new Set(winners.map(match => `${match.operator.id}:${match.rate}`));
  if (distinctValues.size !== 1) {
    return {
      status: 'ambiguous',
      reason: 'multiple verified contracts matched with the same priority',
      contractIds: winners.map(match => match.row.id),
    };
  }

  const winner = winners[0];
  return {
    status: 'resolved',
    contractId: winner.row.id,
    landOperatorId: winner.operator.id,
    landOperator: winner.operator.name,
    commissionRate: winner.rate,
    evidence: winner.row.evidence_url || winner.row.evidence_hash || winner.row.verified_at,
    matchedBy: winner.match.matchedBy,
    matchedValue: winner.match.matchedValue,
  };
}

export async function resolveVerifiedCommercialContract(input: {
  supabase: SupabaseClient;
  source: CommercialContractResolutionInput;
}): Promise<CommercialContractResolution> {
  const asOf = (input.source.asOf ?? new Date()).toISOString().slice(0, 10);
  const { data, error } = await input.supabase
    .from('product_commercial_contracts')
    .select(
      'id, land_operator_id, contract_label, commission_rate, filename_markers, source_label_markers, raw_text_markers, allow_operator_alias_match, valid_from, valid_to, evidence_url, evidence_hash, verified_at, priority, land_operators!inner(id,name,aliases,is_active)',
    )
    .eq('is_active', true)
    .eq('auto_apply', true)
    .lte('valid_from', asOf)
    .or(`valid_to.is.null,valid_to.gte.${asOf}`)
    .order('priority', { ascending: false });

  if (error) return { status: 'lookup_error', reason: error.message };
  return resolveCommercialContractFromRows(input.source, (data ?? []) as unknown as CommercialContractRow[]);
}
