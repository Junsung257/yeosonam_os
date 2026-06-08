import type { SupabaseClient } from '@supabase/supabase-js';

import type { ImprovementLedgerEvent } from './improvement-ledger';

export type ImprovementLedgerPersistenceResult = {
  saved: number;
  error: string | null;
};

type ImprovementLedgerEventRow = {
  created_at: string;
  upload_id: string | null;
  product_id: string | null;
  package_id: string | null;
  attempt_no: number;
  attempt_phase: ImprovementLedgerEvent['attemptPhase'];
  raw_text_hash: string;
  section_raw_text_hash: string | null;
  parser_version: string;
  detected_format: string;
  final_status: ImprovementLedgerEvent['finalStatus'];
  blockers_before: string[];
  blockers_after: string[];
  normalized_blocker_signatures: string[];
  evidence_spans: ImprovementLedgerEvent['evidenceSpans'];
  compared_fields: string[];
  auto_fixes_applied: ImprovementLedgerEvent['autoFixesApplied'];
  packages_audit: ImprovementLedgerEvent['packagesAudit'];
  a4_audit: ImprovementLedgerEvent['a4Audit'];
  fixture_candidate: boolean;
  rule_candidate: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

function normalizeUuid(value: string | null): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

function normalizeHash(value: string): string {
  return SHA256_RE.test(value) ? value.toLowerCase() : value.slice(0, 64).padEnd(64, '0');
}

export function mapImprovementLedgerEventToRow(event: ImprovementLedgerEvent): ImprovementLedgerEventRow {
  return {
    created_at: event.createdAt,
    upload_id: event.uploadId,
    product_id: event.productId,
    package_id: normalizeUuid(event.packageId),
    attempt_no: event.attemptNo,
    attempt_phase: event.attemptPhase,
    raw_text_hash: normalizeHash(event.rawTextHash),
    section_raw_text_hash: event.sectionRawTextHash ? normalizeHash(event.sectionRawTextHash) : null,
    parser_version: event.parserVersion,
    detected_format: event.detectedFormat,
    final_status: event.finalStatus,
    blockers_before: event.blockersBefore,
    blockers_after: event.blockersAfter,
    normalized_blocker_signatures: event.normalizedBlockerSignatures,
    evidence_spans: event.evidenceSpans,
    compared_fields: event.comparedFields,
    auto_fixes_applied: event.autoFixesApplied,
    packages_audit: event.packagesAudit,
    a4_audit: event.a4Audit,
    fixture_candidate: event.fixtureCandidate,
    rule_candidate: event.ruleCandidate,
  };
}

export async function persistImprovementLedgerEvents(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  events: ImprovementLedgerEvent[];
}): Promise<ImprovementLedgerPersistenceResult> {
  if (!input.isSupabaseConfigured || input.events.length === 0) {
    return { saved: 0, error: null };
  }

  const rows = input.events.map(mapImprovementLedgerEventToRow);
  let saved = 0;

  for (let start = 0; start < rows.length; start += 100) {
    const chunk = rows.slice(start, start + 100);
    const { error } = await input.supabase
      .from('product_registration_improvement_events')
      .insert(chunk);

    if (error) {
      return { saved, error: error.message };
    }
    saved += chunk.length;
  }

  return { saved, error: null };
}
