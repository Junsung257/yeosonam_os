import {
  BLOG_INFORMATION_CLAIM_TYPES,
  createBlogInformationClaimFingerprint,
  type BlogInformationClaimType,
  type BlogInformationEvidenceRiskLevel,
} from './blog-information-evidence';

export const BLOG_INFORMATION_CLAIM_LEDGER_START = 'INFORMATION_CLAIM_LEDGER_START';
export const BLOG_INFORMATION_CLAIM_LEDGER_END = 'INFORMATION_CLAIM_LEDGER_END';
export const BLOG_INFORMATION_CLAIM_LEDGER_MAX_ENTRIES = 100;

export const BLOG_INFORMATION_FACTUAL_CANDIDATE_KINDS = [
  'money_price',
  'percentage',
  'distance',
  'time_schedule',
  'date_period',
  'quantity_limit',
  'requirement_prohibition',
  'availability_status',
  'regulated_policy',
  'climate_measurement',
  'superlative',
  'unknown_statement',
] as const;

export type BlogInformationFactualCandidateKind =
  (typeof BLOG_INFORMATION_FACTUAL_CANDIDATE_KINDS)[number];

export interface BlogInformationClaimLedgerEntry {
  claimFingerprint: string;
  claimText: string;
  claimType: BlogInformationClaimType;
  riskLevel: BlogInformationEvidenceRiskLevel;
}

export interface BlogInformationWriterOutput {
  markdown: string;
  claimLedger: BlogInformationClaimLedgerEntry[];
  ledgerIssues: string[];
}

type ApprovedRewriteClaim = {
  claimText: string;
  claimType: string;
  riskLevel: string;
};

function cleanClaimText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isClaimType(value: unknown): value is BlogInformationClaimType {
  return typeof value === 'string'
    && (BLOG_INFORMATION_CLAIM_TYPES as readonly string[]).includes(value);
}

function isRiskLevel(value: unknown): value is BlogInformationEvidenceRiskLevel {
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH';
}

function parseLedgerEntries(value: unknown): {
  claims: BlogInformationClaimLedgerEntry[];
  issues: string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { claims: [], issues: ['claim_ledger_invalid_shape'] };
  }
  const claims = (value as Record<string, unknown>).claims;
  if (!Array.isArray(claims) || claims.length > BLOG_INFORMATION_CLAIM_LEDGER_MAX_ENTRIES) {
    return { claims: [], issues: ['claim_ledger_invalid_shape'] };
  }

  const parsed: BlogInformationClaimLedgerEntry[] = [];
  const issues: string[] = [];
  for (const [index, entry] of claims.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(`claim_ledger_entry_invalid:${index}`);
      continue;
    }
    const record = entry as Record<string, unknown>;
    const rawClaimText = typeof record.claim_text === 'string'
      ? cleanClaimText(record.claim_text)
      : '';
    if (!rawClaimText || rawClaimText.length > 500 || !isClaimType(record.claim_type) || !isRiskLevel(record.risk_level)) {
      issues.push(`claim_ledger_entry_invalid:${index}`);
      continue;
    }
    const claimText = rawClaimText;
    parsed.push({
      claimFingerprint: createBlogInformationClaimFingerprint(claimText),
      claimText,
      claimType: record.claim_type,
      riskLevel: record.risk_level,
    });
  }

  const unique = [...new Map(parsed.map((claim) => [claim.claimFingerprint, claim])).values()];
  return { claims: unique, issues: [...new Set(issues)] };
}

export function parseBlogInformationWriterOutput(raw: string): BlogInformationWriterOutput {
  const start = raw.lastIndexOf(BLOG_INFORMATION_CLAIM_LEDGER_START);
  const end = raw.lastIndexOf(BLOG_INFORMATION_CLAIM_LEDGER_END);
  if (start < 0) {
    return {
      markdown: raw.trim(),
      claimLedger: [],
      ledgerIssues: ['claim_ledger_missing'],
    };
  }
  if (end < start) {
    const commentStart = raw.lastIndexOf('<!--', start);
    return {
      markdown: raw.slice(0, commentStart >= 0 ? commentStart : start).trim(),
      claimLedger: [],
      ledgerIssues: ['claim_ledger_missing_end_marker'],
    };
  }

  const commentStart = raw.lastIndexOf('<!--', start);
  const commentEnd = raw.indexOf('-->', end + BLOG_INFORMATION_CLAIM_LEDGER_END.length);
  const jsonStart = start + BLOG_INFORMATION_CLAIM_LEDGER_START.length;
  const jsonText = raw.slice(jsonStart, end).trim();
  const removeStart = commentStart >= 0 ? commentStart : start;
  const removeEnd = commentEnd >= 0 ? commentEnd + 3 : raw.length;
  const markdown = `${raw.slice(0, removeStart)}${raw.slice(removeEnd)}`.trim();

  try {
    const parsed = parseLedgerEntries(JSON.parse(jsonText));
    return { markdown, claimLedger: parsed.claims, ledgerIssues: parsed.issues };
  } catch {
    return {
      markdown,
      claimLedger: [],
      ledgerIssues: ['claim_ledger_invalid_json'],
    };
  }
}

/**
 * Restore reviewed semantic labels only when the model copied the remainder
 * of an approved claim exactly once in both the body and hidden ledger.
 * Paraphrases and ambiguous matches remain untouched and fail closed later.
 */
export function restoreApprovedRewriteClaimLabels(
  output: BlogInformationWriterOutput,
  approvedClaims: ApprovedRewriteClaim[],
): BlogInformationWriterOutput {
  let markdown = output.markdown;
  let claimLedger = [...output.claimLedger];

  for (const approved of approvedClaims) {
    const exactClaim = cleanClaimText(approved.claimText);
    if (!exactClaim || !isClaimType(approved.claimType) || !isRiskLevel(approved.riskLevel)) continue;
    const canonicalClaimType: BlogInformationClaimType = approved.claimType;
    const canonicalRiskLevel: BlogInformationEvidenceRiskLevel = approved.riskLevel;
    const canonicalizeLedgerEntry = (claimText: string) => {
      const matches = claimLedger.filter((claim) => cleanClaimText(claim.claimText) === claimText);
      if (matches.length !== 1) return false;
      claimLedger = claimLedger.map((claim) => claim === matches[0]
        ? {
            claimFingerprint: createBlogInformationClaimFingerprint(exactClaim),
            claimText: exactClaim,
            claimType: canonicalClaimType,
            riskLevel: canonicalRiskLevel,
          }
        : claim);
      return true;
    };
    const exactBodyMatches = markdown.split(exactClaim).length - 1;
    if (exactBodyMatches === 1) {
      canonicalizeLedgerEntry(exactClaim);
      continue;
    }
    const strippedClaim = exactClaim.replace(/^(?:\[[^\]\r\n]{1,80}\]\s*)+/, '').trim();
    if (!strippedClaim || strippedClaim === exactClaim) continue;
    const bodyMatches = markdown.split(strippedClaim).length - 1;
    const ledgerMatches = claimLedger.filter((claim) => cleanClaimText(claim.claimText) === strippedClaim);
    if (bodyMatches !== 1 || ledgerMatches.length !== 1) continue;

    markdown = markdown.replace(strippedClaim, exactClaim);
    claimLedger = claimLedger.map((claim) => claim === ledgerMatches[0]
      ? {
          claimFingerprint: createBlogInformationClaimFingerprint(exactClaim),
          claimText: exactClaim,
          claimType: canonicalClaimType,
          riskLevel: canonicalRiskLevel,
        }
      : claim);
  }

  return { ...output, markdown, claimLedger };
}

export function buildBlogInformationClaimLedgerPromptContract(): string {
  return [
    '## Structured factual claim ledger (required, hidden from readers)',
    '- After the article, append exactly one HTML comment using the schema below.',
    '- Copy every factual claim as the exact complete sentence or exact table row from the visible article.',
    '- Include claims from body paragraphs, lists, tables, and FAQ answers.',
    '- Include money, percentages, distance, schedules/hours, dates/periods, quantities/limits, requirements/prohibitions, availability/operations, visa/passport/customs/insurance/entry policy, climate measurements, and superlatives.',
    '- Use {"claims":[]} only when the article truly contains none of those claims.',
    '- claim_type must be one of: price, currency, duration, percentage, climate, customs, entry_visa, insurance, policy, superlative, factual.',
    '- risk_level must be LOW, MEDIUM, or HIGH.',
    '<!-- INFORMATION_CLAIM_LEDGER_START',
    '{"claims":[{"claim_text":"exact sentence copied from the article","claim_type":"factual","risk_level":"MEDIUM"}]}',
    'INFORMATION_CLAIM_LEDGER_END -->',
  ].join('\n');
}
