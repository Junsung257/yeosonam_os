export type RagIndexIssueSeverity = 'critical' | 'warning' | 'info';

export type RagIndexIssueCode =
  | 'empty_chunk_text'
  | 'empty_contextual_text'
  | 'short_chunk_text'
  | 'short_contextual_text'
  | 'context_not_enriched'
  | 'missing_source_title'
  | 'missing_source_ref'
  | 'missing_content_hash'
  | 'stale_chunk'
  | 'duplicate_source_chunk'
  | 'missing_expected_source';

export interface RagIndexAuditRow {
  id: string;
  tenant_id: string | null;
  source_type: string | null;
  source_id: string | null;
  source_url: string | null;
  source_title: string | null;
  chunk_index: number | null;
  chunk_text: string | null;
  contextual_text: string | null;
  content_hash: string | null;
  updated_at: string | null;
}

export interface RagIndexAuditOptions {
  now?: Date;
  staleAfterDays?: number;
  minChunkChars?: number;
  minContextualChars?: number;
  expectedSourceTypes?: string[];
  sampleIssueLimit?: number;
}

export interface RagIndexSourceBreakdown {
  sourceType: string;
  count: number;
  share: number;
  staleCount: number;
  issueCount: number;
}

export interface RagIndexIssueSample {
  id: string;
  sourceType: string;
  sourceTitle: string | null;
  chunkIndex: number | null;
  issues: RagIndexIssueCode[];
}

export interface RagIndexRemediationAction {
  id: string;
  priority: 1 | 2 | 3;
  severity: RagIndexIssueSeverity;
  title: string;
  description: string;
  affectedIssueCodes: RagIndexIssueCode[];
  affectedSourceTypes: string[];
  sampleIds: string[];
  commands: string[];
}

export interface RagIndexAuditSummary {
  sampledRows: number;
  qualityScore: number;
  readinessLevel: 'ready' | 'watch' | 'blocked';
  issueCounts: Record<RagIndexIssueCode, number>;
  sourceBreakdown: RagIndexSourceBreakdown[];
  coverage: {
    expectedSourceTypes: string[];
    presentSourceTypes: string[];
    missingSourceTypes: string[];
    score: number;
  };
  samples: RagIndexIssueSample[];
  remediationActions: RagIndexRemediationAction[];
}

const DEFAULT_OPTIONS: Required<Omit<RagIndexAuditOptions, 'now'>> = {
  staleAfterDays: 30,
  minChunkChars: 80,
  minContextualChars: 120,
  expectedSourceTypes: ['package', 'blog', 'attraction'],
  sampleIssueLimit: 12,
};

const ISSUE_SEVERITY: Record<RagIndexIssueCode, RagIndexIssueSeverity> = {
  empty_chunk_text: 'critical',
  empty_contextual_text: 'critical',
  short_chunk_text: 'warning',
  short_contextual_text: 'warning',
  context_not_enriched: 'warning',
  missing_source_title: 'warning',
  missing_source_ref: 'warning',
  missing_content_hash: 'info',
  stale_chunk: 'info',
  duplicate_source_chunk: 'critical',
  missing_expected_source: 'warning',
};

const ISSUE_WEIGHT: Record<RagIndexIssueSeverity, number> = {
  critical: 18,
  warning: 7,
  info: 3,
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000);
}

function duplicateKey(row: RagIndexAuditRow): string | null {
  const sourceType = normalizeText(row.source_type);
  const sourceId = normalizeText(row.source_id);
  if (!sourceType || !sourceId || row.chunk_index === null || row.chunk_index === undefined) {
    return null;
  }
  return `${row.tenant_id ?? 'shared'}:${sourceType}:${sourceId}:${row.chunk_index}`;
}

function incrementIssue(
  counts: Record<RagIndexIssueCode, number>,
  code: RagIndexIssueCode,
): void {
  counts[code] = (counts[code] ?? 0) + 1;
}

function emptyIssueCounts(): Record<RagIndexIssueCode, number> {
  return {
    empty_chunk_text: 0,
    empty_contextual_text: 0,
    short_chunk_text: 0,
    short_contextual_text: 0,
    context_not_enriched: 0,
    missing_source_title: 0,
    missing_source_ref: 0,
    missing_content_hash: 0,
    stale_chunk: 0,
    duplicate_source_chunk: 0,
    missing_expected_source: 0,
  };
}

function sourceAdapterName(sourceType: string): string {
  if (sourceType === 'package') return 'packages';
  if (sourceType === 'blog') return 'blogs';
  if (sourceType === 'attraction') return 'attractions';
  return sourceType;
}

function sourceTypesForIssues(
  samples: RagIndexIssueSample[],
  issueCodes: RagIndexIssueCode[],
): string[] {
  return [...new Set(
    samples
      .filter((sample) => sample.issues.some((issue) => issueCodes.includes(issue)))
      .map((sample) => sample.sourceType)
      .filter((sourceType) => sourceType !== 'unknown'),
  )].sort();
}

function sampleIdsForIssues(
  samples: RagIndexIssueSample[],
  issueCodes: RagIndexIssueCode[],
): string[] {
  return samples
    .filter((sample) => sample.issues.some((issue) => issueCodes.includes(issue)))
    .map((sample) => sample.id);
}

function reindexCommands(sourceTypes: string[]): string[] {
  if (sourceTypes.length === 0) return ['node db/rag_reindex_all.js'];
  return sourceTypes.map((sourceType) => `node db/rag_reindex_all.js --source=${sourceAdapterName(sourceType)}`);
}

function buildRemediationActions(
  issueCounts: Record<RagIndexIssueCode, number>,
  samples: RagIndexIssueSample[],
  missingSourceTypes: string[],
): RagIndexRemediationAction[] {
  const actions: RagIndexRemediationAction[] = [];

  const addAction = (action: RagIndexRemediationAction, shouldAdd: boolean) => {
    if (shouldAdd) actions.push(action);
  };

  addAction({
    id: 'dedupe-source-chunks',
    priority: 1,
    severity: 'critical',
    title: 'Review duplicate source chunks',
    description: 'Duplicate source/chunk rows can skew hybrid retrieval and citations. Review duplicate groups before deleting rows, especially shared tenant_id NULL chunks.',
    affectedIssueCodes: ['duplicate_source_chunk'],
    affectedSourceTypes: sourceTypesForIssues(samples, ['duplicate_source_chunk']),
    sampleIds: sampleIdsForIssues(samples, ['duplicate_source_chunk']),
    commands: [
      'npm run audit:jarvis-rag -- --json',
    ],
  }, issueCounts.duplicate_source_chunk > 0);

  const brokenContentIssues: RagIndexIssueCode[] = [
    'empty_chunk_text',
    'empty_contextual_text',
    'context_not_enriched',
  ];
  const brokenContentSources = sourceTypesForIssues(samples, brokenContentIssues);
  addAction({
    id: 'rerun-contextual-indexing',
    priority: 1,
    severity: 'critical',
    title: 'Re-run contextual indexing for broken chunks',
    description: 'Empty or non-enriched chunks usually mean the source adapter or contextualization call failed. Fix adapter output or model credentials, then reindex affected sources.',
    affectedIssueCodes: brokenContentIssues,
    affectedSourceTypes: brokenContentSources,
    sampleIds: sampleIdsForIssues(samples, brokenContentIssues),
    commands: reindexCommands(brokenContentSources),
  }, brokenContentIssues.some((issue) => issueCounts[issue] > 0));

  const thinContentIssues: RagIndexIssueCode[] = ['short_chunk_text', 'short_contextual_text'];
  const thinContentSources = sourceTypesForIssues(samples, thinContentIssues);
  addAction({
    id: 'review-thin-rag-content',
    priority: 2,
    severity: 'warning',
    title: 'Review thin RAG content',
    description: 'Short chunks are often low-value retrieval units. Review the source content, merge tiny chunks when needed, then reindex the affected source.',
    affectedIssueCodes: thinContentIssues,
    affectedSourceTypes: thinContentSources,
    sampleIds: sampleIdsForIssues(samples, thinContentIssues),
    commands: [
      ...thinContentSources.map((sourceType) => `npm run audit:jarvis-rag -- --source=${sourceType}`),
      ...reindexCommands(thinContentSources),
    ],
  }, thinContentIssues.some((issue) => issueCounts[issue] > 0));

  const metadataIssues: RagIndexIssueCode[] = ['missing_source_title', 'missing_source_ref', 'missing_content_hash'];
  const metadataSources = sourceTypesForIssues(samples, metadataIssues);
  addAction({
    id: 'repair-citation-metadata',
    priority: 2,
    severity: 'warning',
    title: 'Repair citation metadata',
    description: 'Jarvis needs title, source reference, and content hash fields for grounded answers, dedupe, and explainable citations. Patch the source adapter before reindexing.',
    affectedIssueCodes: metadataIssues,
    affectedSourceTypes: metadataSources,
    sampleIds: sampleIdsForIssues(samples, metadataIssues),
    commands: reindexCommands(metadataSources),
  }, metadataIssues.some((issue) => issueCounts[issue] > 0));

  const staleSources = sourceTypesForIssues(samples, ['stale_chunk']);
  addAction({
    id: 'refresh-stale-rag-source',
    priority: 3,
    severity: 'info',
    title: 'Refresh stale RAG source',
    description: 'Stale chunks should be refreshed so Jarvis does not cite outdated packages, blog posts, or attraction facts.',
    affectedIssueCodes: ['stale_chunk'],
    affectedSourceTypes: staleSources,
    sampleIds: sampleIdsForIssues(samples, ['stale_chunk']),
    commands: reindexCommands(staleSources),
  }, issueCounts.stale_chunk > 0);

  addAction({
    id: 'restore-source-coverage',
    priority: 2,
    severity: 'warning',
    title: 'Restore expected source coverage',
    description: 'The recent audit sample is missing one or more expected RAG sources. Run source-specific audits and reindex if the source count is actually low.',
    affectedIssueCodes: ['missing_expected_source'],
    affectedSourceTypes: missingSourceTypes,
    sampleIds: [],
    commands: [
      ...missingSourceTypes.map((sourceType) => `npm run audit:jarvis-rag -- --source=${sourceType}`),
      ...reindexCommands(missingSourceTypes),
    ],
  }, issueCounts.missing_expected_source > 0);

  return actions.sort((a, b) => a.priority - b.priority || b.sampleIds.length - a.sampleIds.length || a.id.localeCompare(b.id));
}

export function getRagIndexIssueSeverity(code: RagIndexIssueCode): RagIndexIssueSeverity {
  return ISSUE_SEVERITY[code];
}

export function auditRagIndexRows(
  rows: RagIndexAuditRow[],
  options: RagIndexAuditOptions = {},
): RagIndexAuditSummary {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const now = options.now ?? new Date();
  const issueCounts = emptyIssueCounts();
  const rowIssues = new Map<string, RagIndexIssueCode[]>();
  const duplicateKeys = new Map<string, number>();

  for (const row of rows) {
    const key = duplicateKey(row);
    if (!key) continue;
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
  }

  for (const row of rows) {
    const issues: RagIndexIssueCode[] = [];
    const chunkText = normalizeText(row.chunk_text);
    const contextualText = normalizeText(row.contextual_text);

    if (!chunkText) issues.push('empty_chunk_text');
    else if (chunkText.length < opts.minChunkChars) issues.push('short_chunk_text');

    if (!contextualText) issues.push('empty_contextual_text');
    else if (contextualText.length < opts.minContextualChars) issues.push('short_contextual_text');

    if (chunkText && contextualText && contextualText === chunkText) {
      issues.push('context_not_enriched');
    }

    if (!normalizeText(row.source_title)) issues.push('missing_source_title');
    if (!normalizeText(row.source_id) && !normalizeText(row.source_url)) issues.push('missing_source_ref');
    if (!normalizeText(row.content_hash)) issues.push('missing_content_hash');

    if (row.updated_at) {
      const updatedAt = new Date(row.updated_at);
      if (!Number.isNaN(updatedAt.getTime()) && daysBetween(now, updatedAt) > opts.staleAfterDays) {
        issues.push('stale_chunk');
      }
    }

    const key = duplicateKey(row);
    if (key && (duplicateKeys.get(key) ?? 0) > 1) {
      issues.push('duplicate_source_chunk');
    }

    if (issues.length > 0) {
      rowIssues.set(row.id, issues);
      for (const issue of issues) incrementIssue(issueCounts, issue);
    }
  }

  const presentSourceTypes = [...new Set(rows.map((row) => normalizeText(row.source_type)).filter(Boolean))].sort();
  const missingSourceTypes = opts.expectedSourceTypes.filter((sourceType) => !presentSourceTypes.includes(sourceType));
  for (const _sourceType of missingSourceTypes) incrementIssue(issueCounts, 'missing_expected_source');

  const sourceBreakdown = presentSourceTypes
    .map((sourceType) => {
      const sourceRows = rows.filter((row) => normalizeText(row.source_type) === sourceType);
      return {
        sourceType,
        count: sourceRows.length,
        share: rows.length === 0 ? 0 : sourceRows.length / rows.length,
        staleCount: sourceRows.filter((row) => rowIssues.get(row.id)?.includes('stale_chunk')).length,
        issueCount: sourceRows.reduce((sum, row) => sum + (rowIssues.get(row.id)?.length ?? 0), 0),
      };
    })
    .sort((a, b) => b.count - a.count || a.sourceType.localeCompare(b.sourceType));

  const weightedPenalty = (Object.entries(issueCounts) as [RagIndexIssueCode, number][])
    .reduce((sum, [code, count]) => sum + count * ISSUE_WEIGHT[ISSUE_SEVERITY[code]], 0);
  const rowDenominator = Math.max(rows.length, 1);
  const qualityScore = Math.max(0, Math.floor(100 - (weightedPenalty / rowDenominator)));
  const hasCritical = (Object.entries(issueCounts) as [RagIndexIssueCode, number][])
    .some(([code, count]) => count > 0 && ISSUE_SEVERITY[code] === 'critical');
  const hasCoverageGap = missingSourceTypes.length > 0;
  const readinessLevel = qualityScore >= 90 && !hasCritical
    ? (hasCoverageGap ? 'watch' : 'ready')
    : qualityScore >= 75
      ? 'watch'
      : 'blocked';

  const samples = rows
    .filter((row) => rowIssues.has(row.id))
    .slice(0, opts.sampleIssueLimit)
    .map((row) => ({
      id: row.id,
      sourceType: normalizeText(row.source_type) || 'unknown',
      sourceTitle: normalizeText(row.source_title) || null,
      chunkIndex: row.chunk_index,
      issues: rowIssues.get(row.id) ?? [],
    }));
  const remediationActions = buildRemediationActions(issueCounts, samples, missingSourceTypes);

  return {
    sampledRows: rows.length,
    qualityScore,
    readinessLevel,
    issueCounts,
    sourceBreakdown,
    coverage: {
      expectedSourceTypes: opts.expectedSourceTypes,
      presentSourceTypes,
      missingSourceTypes,
      score: opts.expectedSourceTypes.length === 0
        ? 1
        : (opts.expectedSourceTypes.length - missingSourceTypes.length) / opts.expectedSourceTypes.length,
    },
    samples,
    remediationActions,
  };
}
