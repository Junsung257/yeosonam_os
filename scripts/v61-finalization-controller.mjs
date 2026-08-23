import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ID = process.env.V61_FINALIZATION_RUN_ID || randomUUID();
const DATE = process.env.V61_FINALIZATION_DATE || new Date().toISOString().slice(0, 10);
const DEFAULT_AUDIT_RELATIVE = 'docs/audits/' + DATE + '-v61-true-finalization';
const AUDIT_RELATIVE = process.env.V61_FINALIZATION_AUDIT_DIR || DEFAULT_AUDIT_RELATIVE;
const AUDIT_DIR = resolve(ROOT, AUDIT_RELATIVE);
const CANARY_APPROVAL_SENTINEL = 'APPROVE V6.1 PRODUCTION CANARY LANE A';
const RECOVERY_APPROVAL_SENTINEL = 'APPROVE V6.1 EXISTING PRODUCT RECOVERY LANE B';
const LANE_IDS = Object.freeze({
  productionManualRollout: 'LANE_A_PRODUCTION_MANUAL_ROLLOUT',
  existingProductRecovery: 'LANE_B_EXISTING_PRODUCT_RECOVERY',
  goldSourceAcquisition: 'LANE_C_GOLD_SOURCE_ACQUISITION',
  humanDualReview: 'LANE_D_HUMAN_DUAL_REVIEW',
});
const SOURCE_EXTENSIONS = new Set(['.hwp', '.hwpx', '.pdf', '.docx', '.xlsx', '.xls', '.txt', '.json']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'coverage', 'dist', 'build', '.turbo']);

function hasFlag(name) {
  return process.argv.includes('--' + name);
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath) {
  try {
    return sha256Bytes(readFileSync(filePath));
  } catch {
    return null;
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    try {
      return JSON.parse(readFileSync(filePath, 'utf8').replace(/\\n$/u, ''));
    } catch {
      return fallback;
    }
  }
}

function readJsonLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .replace(/\\n/g, '\n')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function atomicWrite(filePath, contents) {
  const tempPath = filePath + '.tmp-' + process.pid + '-' + Date.now();
  writeFileSync(tempPath, contents, 'utf8');
  renameSync(tempPath, filePath);
}

function writeJson(filePath, value) {
  atomicWrite(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonLines(filePath, rows) {
  atomicWrite(filePath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

function appendJsonLine(filePath, row) {
  const current = existsSync(filePath)
    ? readFileSync(filePath, 'utf8').replace(/\\n/g, '\n').replace(/\s*$/u, '')
    : '';
  const next = current ? current + '\n' + JSON.stringify(row) + '\n' : JSON.stringify(row) + '\n';
  atomicWrite(filePath, next);
}

function ensureAuditDir() {
  if (!existsSync(AUDIT_DIR)) {
    const parent = dirname(AUDIT_DIR);
    if (!existsSync(parent)) {
      throw new Error('Audit parent directory is missing: ' + parent);
    }
    const leaf = AUDIT_DIR.slice(parent.length + 1);
    if (leaf.includes('..')) throw new Error('Unsafe audit directory');
    mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

function walkFiles(rootPath, output, seen, allowedExtensions = SOURCE_EXTENSIONS) {
  if (!existsSync(rootPath)) return;
  let entries;
  try {
    entries = readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.isSymbolicLink()) {
        walkFiles(fullPath, output, seen, allowedExtensions);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!allowedExtensions.has(extension)) continue;
    const normalized = resolve(fullPath);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  }
}

function candidateRoots() {
  const roots = [
    ROOT,
    'C:\\dev\\yeosonam-os',
    'C:\\Users\\admin\\Downloads',
    'C:\\Users\\admin\\.codex\\attachments',
    'C:\\Users\\admin\\Desktop',
    'C:\\Users\\admin\\Documents',
  ];
  return [...new Set(roots.map(root => resolve(root)))].filter(root => existsSync(root));
}

function findArtifact(relativeOrAbsolute) {
  const absolute = resolve(relativeOrAbsolute);
  return existsSync(absolute) ? absolute : null;
}

function corpusEntries(artifactPath) {
  const document = readJson(artifactPath, null);
  return document && Array.isArray(document.entries) ? document.entries : [];
}

function corpusId(entry, index) {
  return String(entry.corpusId || entry.id || `${entry.sourceHash || 'no-source-hash'}:${index}`);
}

function sourceRowReason(status) {
  return {
    SOURCE_VERIFIED: 'EXPECTED_HASH_MATCHED_OBSERVED_SOURCE',
    SOURCE_MISSING: 'NO_CANDIDATE_FILE_IN_SEARCH_ROOTS',
    SOURCE_HASH_MISMATCH: 'OBSERVED_HASH_DIFFERS_FROM_LEDGER',
    SOURCE_CORRUPTED: 'SOURCE_BYTES_UNREADABLE_OR_CORRUPTED',
    SOURCE_DUPLICATE: 'MULTIPLE_CANDIDATES_MATCH_EXPECTED_HASH',
    SOURCE_POPULATION_UNPROVEN: 'CORPUS_ROW_LACKS_SOURCE_HASH_OR_IDENTITY',
    SOURCE_UNSUPPORTED: 'SOURCE_TYPE_OR_SOURCE_RECORD_UNSUPPORTED',
  }[status] || 'UNCLASSIFIED_SOURCE_STATE';
}

function sourceRecovery() {
  const fullArtifact = findArtifact('C:\\Users\\admin\\Downloads\\코덱스테스트\\product-registration-current-corpus-v181-live-policy-full.json');
  const currentArtifact = findArtifact('C:\\Users\\admin\\Downloads\\코덱스테스트\\product-registration-current-corpus-v181-live-policy.json');
  const entries = corpusEntries(fullArtifact);
  const files = [];
  const seen = new Set();
  for (const root of candidateRoots()) walkFiles(root, files, seen);
  const byName = new Map();
  for (const filePath of files) {
    const name = filePath.split(/[\\/]/u).pop();
    const list = byName.get(name) || [];
    list.push(filePath);
    byName.set(name, list);
  }

  const counts = {
    corpusEntries: entries.length,
    exactPathPresent: 0,
    sourceHashVerified: 0,
    sourceRecoveredByFilename: 0,
    sourceDuplicate: 0,
    sourceCorrupt: 0,
    sourceMissing: 0,
    searchedFiles: files.length,
    filenameCandidates: 0,
    filenameHashMismatches: 0,
  };

  const rows = [];
  for (const [index, entry] of entries.entries()) {
    const expected = String(entry.sourceHash || '').toLowerCase();
    const originalPath = String(entry.sourcePath || '');
    const filename = originalPath.split(/[\\/]/u).pop() || String(entry.filename || '');
    const exactPathExists = Boolean(originalPath && existsSync(originalPath));
    const candidates = exactPathExists
      ? [originalPath]
      : (byName.get(filename) || []);
    const observed = candidates
      .map(candidate => ({ path: candidate, hash: sha256File(candidate) }))
      .filter(candidate => candidate.hash);
    const matching = expected
      ? observed.filter(candidate => candidate.hash === expected)
      : [];
    let sourceStatus;
    let observedPath = null;
    let sourceRecoveryMethod = null;
    if (!expected) {
      sourceStatus = 'SOURCE_POPULATION_UNPROVEN';
    } else if (matching.length === 1) {
      sourceStatus = 'SOURCE_VERIFIED';
      observedPath = matching[0].path;
      sourceRecoveryMethod = exactPathExists ? 'EXACT_PATH' : 'FILENAME_HASH_RECOVERY';
      counts.sourceHashVerified += 1;
      if (exactPathExists) counts.exactPathPresent += 1;
      else counts.sourceRecoveredByFilename += 1;
    } else if (matching.length > 1) {
      sourceStatus = 'SOURCE_DUPLICATE';
      counts.sourceDuplicate += 1;
      if (exactPathExists) counts.exactPathPresent += 1;
    } else if (observed.length > 0) {
      sourceStatus = 'SOURCE_HASH_MISMATCH';
      counts.sourceCorrupt += 1;
      counts.filenameHashMismatches += exactPathExists ? 0 : 1;
      if (exactPathExists) counts.exactPathPresent += 1;
    } else {
      sourceStatus = 'SOURCE_MISSING';
      counts.sourceMissing += 1;
    }
    if (!exactPathExists && candidates.length > 0) counts.filenameCandidates += 1;

    const prelabel = entry.prelabel || {};
    const sectionCount = Number(prelabel.sectionCount || 0);
    const statusRow = {
      corpusId: corpusId(entry, index),
      supplier: entry.supplier || entry.supplierKey || entry.landOperator || null,
      documentFamily: entry.documentFamily || entry.documentClass || null,
      sectionId: Array.isArray(prelabel.sectionHashes) ? prelabel.sectionHashes : [],
      expectedSourceFilename: filename || null,
      sourceLocation: originalPath || null,
      observedSourceLocation: observedPath,
      sourceHash: expected || null,
      normalizedTextHash: entry.normalizedTextHash || null,
      observedHash: observedPath ? sha256File(observedPath) : null,
      observedHashes: [...new Set(observed.map(item => item.hash))],
      sourceStatus,
      sourceRecoveryMethod,
      duplicateGroup: matching.length > 1
        ? sha256Bytes(Buffer.from(matching.map(item => item.path).sort().join('|')))
        : null,
      lineageParent: entry.lineageHash || null,
      reasonCode: sourceRowReason(sourceStatus),
      nextAction: sourceStatus === 'SOURCE_VERIFIED'
        ? 'AVAILABLE_FOR_REVIEW_PACKET'
        : sourceStatus === 'SOURCE_MISSING'
          ? 'ACQUIRE_ORIGINAL_SOURCE_AND_VERIFY_HASH'
          : sourceStatus === 'SOURCE_HASH_MISMATCH'
            ? 'MANUAL_SOURCE_RECONCILIATION_REQUIRED'
            : sourceStatus === 'SOURCE_DUPLICATE'
              ? 'DISAMBIGUATE_DUPLICATE_SOURCE_FILES'
              : 'REVIEW_SOURCE_IDENTITY_AND_SUPPORT',
      split: entry.split || null,
      documentClass: entry.documentClass || null,
      sectionCount,
      prelabelStatus: prelabel.status || null,
      prelabelEvidence: {
        kernelBlockers: Array.isArray(prelabel.kernelBlockers) ? prelabel.kernelBlockers : [],
        blockers: Array.isArray(prelabel.blockers) ? prelabel.blockers : [],
        sectionBlockers: Array.isArray(prelabel.sectionBlockers) ? prelabel.sectionBlockers : [],
        sourceSalePriceDispositions: Array.isArray(prelabel.sourceSalePriceDispositions)
          ? prelabel.sourceSalePriceDispositions
          : [],
        departureDatePolicy: prelabel.departureDatePolicy || null,
        extraction: entry.extraction || null,
      },
    };
    rows.push(statusRow);
  }

  const currentEntries = corpusEntries(currentArtifact);
  let currentSectionCount = 0;
  let currentFrozenSectionCount = 0;
  let currentHashVerified = 0;
  for (const entry of currentEntries) {
    const sections = Number(entry?.prelabel?.sectionCount || 0);
    currentSectionCount += sections;
    if (entry.split === 'frozen') currentFrozenSectionCount += sections;
    if (rows.some(row => row.sourceStatus === 'SOURCE_VERIFIED' && row.sourceHash === String(entry.sourceHash || '').toLowerCase())) {
      currentHashVerified += 1;
    }
  }

  const verifiedSourceSections = rows
    .filter(row => row.sourceStatus === 'SOURCE_VERIFIED')
    .reduce((sum, row) => sum + row.sectionCount, 0);
  const missingSourceSections = rows
    .filter(row => row.sourceStatus === 'SOURCE_MISSING')
    .reduce((sum, row) => sum + row.sectionCount, 0);
  const projectionRows = rows
    .filter(row => row.sourceStatus !== 'SOURCE_VERIFIED')
    .sort((left, right) => right.sectionCount - left.sectionCount || left.corpusId.localeCompare(right.corpusId));
  let projectedSections = 0;
  let minimumAdditionalRowsByMetadataProjection = 0;
  for (const row of projectionRows) {
    if (verifiedSourceSections + projectedSections >= 400) break;
    projectedSections += row.sectionCount;
    minimumAdditionalRowsByMetadataProjection += 1;
  }

  return {
    fullArtifact: fullArtifact ? relative(ROOT, fullArtifact).replaceAll('\\', '/') : null,
    currentArtifact: currentArtifact ? relative(ROOT, currentArtifact).replaceAll('\\', '/') : null,
    counts,
    currentCandidate: {
      sourceRows: currentEntries.length,
      sections: currentSectionCount,
      frozenSections: currentFrozenSectionCount,
      sourceHashVerified: currentHashVerified,
    },
    rows,
    verifiedSourceSections,
    missingSourceSections,
    goldGap: {
      targetSections: 400,
      additionalVerifiedSectionsNeeded: Math.max(0, 400 - verifiedSourceSections),
      minimumAdditionalRowsByMetadataProjection,
      projectedSections: projectedSections,
      projectionIsNotGoldEvidence: true,
    },
  };
}

function existingInventory() {
  const filePath = join(AUDIT_DIR, 'existing-product-inventory.jsonl');
  const rows = readJsonLines(filePath).filter(row => row.recordType === 'existing_product');
  return rows;
}

function writeCatalogManifests(inventory) {
  const recoveryRows = [
    {
      recordType: 'manifest',
      status: 'PLAN_ONLY_NOT_EXECUTED',
      catalogTotal: inventory.length,
      actualWrites: 0,
      pointerChanges: 0,
      targetStates: ['VALIDATED_PUBLISHED', 'SAFE_UNDER_REVIEW'],
      note: 'Read-only inventory was transformed into a recovery plan; no production mutation occurred.',
    },
    ...inventory.map(row => ({
      recordType: 'product_recovery_plan',
      productKey: row.product_key,
      catalogProductKey: row.catalog_product_key,
      currentPackageStatus: row.package_status,
      currentPublicationState: row.publication_state,
      recoverabilityClass: row.recoverability_class,
      sourceHashVerified: row.source_hash_verified === true,
      lineageHashVerified: row.lineage_hash_verified === true,
      customerPointerState: row.customer_pointer_state,
      customerPointerBound: row.customer_pointer_bound === true,
      plannedDisposition: row.recoverability_class === 'C_NO_V6_SOURCE_BINDING'
        ? 'SAFE_UNDER_REVIEW_PLANNED'
        : 'VALIDATED_PUBLISHED_REQUIRES_MANUAL_PROOF_GATE',
      executionStatus: 'NOT_EXECUTED',
    })),
  ];
  writeJsonLines(join(AUDIT_DIR, 'product-recovery-manifest.jsonl'), recoveryRows);

  const safeRows = [
    {
      recordType: 'manifest',
      status: 'PLAN_ONLY_NOT_EXECUTED',
      targetStatus: 'SAFE_UNDER_REVIEW',
      count: inventory.filter(row => row.recoverability_class === 'C_NO_V6_SOURCE_BINDING').length,
      customerFactsExposed: false,
      automaticPublication: false,
    },
    ...inventory
      .filter(row => row.recoverability_class === 'C_NO_V6_SOURCE_BINDING')
      .map(row => ({
        recordType: 'safe_under_review_plan',
        productKey: row.product_key,
        catalogProductKey: row.catalog_product_key,
        currentPackageStatus: row.package_status,
        currentPublicationState: row.publication_state,
        targetState: 'SAFE_UNDER_REVIEW',
        executionStatus: 'NOT_EXECUTED',
        sourceRequestRequired: true,
        customerFactsExposed: false,
      })),
  ];
  writeJsonLines(join(AUDIT_DIR, 'safe-under-review-inventory.jsonl'), safeRows);

  return {
    total: inventory.length,
    classA: inventory.filter(row => row.recoverability_class === 'A_SOURCE_AND_LINEAGE_READY').length,
    classB: inventory.filter(row => row.recoverability_class === 'B_PARTIAL_OR_REVIEW').length,
    classC: inventory.filter(row => row.recoverability_class === 'C_NO_V6_SOURCE_BINDING').length,
    actualWrites: 0,
    pointerChanges: 0,
  };
}

function writeGoldSourceManifest(source) {
  const currentArtifactPath = findArtifact('C:\\Users\\admin\\Downloads\\코덱스테스트\\product-registration-current-corpus-v181-live-policy.json');
  const entries = corpusEntries(currentArtifactPath);
  const verifiedByHash = new Set(source.rows
    .filter(row => row.sourceStatus === 'SOURCE_VERIFIED')
    .map(row => row.sourceHash));
  const rows = [
    {
      recordType: 'manifest',
      status: 'CANDIDATE_ONLY_NOT_GOLD',
      candidateSourceRows: entries.length,
      candidateSections: source.currentCandidate.sections,
      frozenCandidateSections: source.currentCandidate.frozenSections,
      sourceHashVerifiedRows: source.currentCandidate.sourceHashVerified,
      goldTargetSections: 400,
      goldEligible: false,
      humanReviewStatus: 'NOT_ASSIGNED',
    },
    ...entries.map(entry => ({
      recordType: 'gold_source_candidate',
      sourceHash: String(entry.sourceHash || ''),
      lineageHash: String(entry.lineageHash || ''),
      sectionCount: Number(entry?.prelabel?.sectionCount || 0),
      split: entry.split || null,
      documentClass: entry.documentClass || null,
      prelabelStatus: entry?.prelabel?.status || null,
      sourceHashVerified: verifiedByHash.has(String(entry.sourceHash || '').toLowerCase()),
      reviewerA: 'NOT_ASSIGNED',
      reviewerB: 'NOT_ASSIGNED',
      goldEligible: false,
    })),
  ];
  writeJsonLines(join(AUDIT_DIR, 'gold-source-manifest.jsonl'), rows);
}

function writeSourceReconciliationArtifacts(source) {
  const statusCounts = source.rows.reduce((counts, row) => {
    counts[row.sourceStatus] = (counts[row.sourceStatus] || 0) + 1;
    return counts;
  }, {});
  const reconciliation = {
    schemaVersion: 'v61-source-reconciliation-final-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    population: {
      corpusEntries: source.counts.corpusEntries,
      rowCountReconciles: source.rows.length === source.counts.corpusEntries,
      statusCounts,
      formula: Object.values(statusCounts).reduce((sum, value) => sum + value, 0) + ' = ' + source.counts.corpusEntries,
    },
    counts: source.counts,
    verifiedSourceSections: source.verifiedSourceSections,
    missingSourceSections: source.missingSourceSections,
    goldGap: source.goldGap,
    rows: source.rows,
    immutableSourceRule: 'Metadata, parser output, and synthetic text never replace missing original bytes.',
  };
  writeJson(join(AUDIT_DIR, 'source-reconciliation-final.json'), reconciliation);
  writeJson(join(AUDIT_DIR, 'gold-population-final.json'), {
    schemaVersion: 'v61-gold-population-final-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    populationDefinition: 'Verified original source rows from the 1,171-row private corpus; no metadata-only row is Gold evidence.',
    status: source.verifiedSourceSections >= 400 ? 'SOURCE_CAPACITY_REQUIRES_HUMAN_REVIEW' : 'EXTERNALLY_BLOCKED_SOURCE_CAPACITY',
    targetSections: 400,
    verifiedSourceRows: source.rows.filter(row => row.sourceStatus === 'SOURCE_VERIFIED').length,
    verifiedSourceSections: source.verifiedSourceSections,
    frozenVerifiedSections: source.rows
      .filter(row => row.sourceStatus === 'SOURCE_VERIFIED' && row.split === 'frozen')
      .reduce((sum, row) => sum + row.sectionCount, 0),
    additionalVerifiedSectionsNeeded: source.goldGap.additionalVerifiedSectionsNeeded,
    minimumAdditionalRowsByMetadataProjection: source.goldGap.minimumAdditionalRowsByMetadataProjection,
    projectionWarning: 'The metadata projection is not a Gold count until original bytes are hash-verified and human-reviewed.',
    sourceManifest: 'source-reconciliation-final.json',
    goldEligible: false,
    humanReviewStatus: 'NOT_SUPPLIED',
  });
  const verifiedRows = source.rows.filter(row => row.sourceStatus === 'SOURCE_VERIFIED' && row.documentClass === 'travel_product');
  writeJson(join(AUDIT_DIR, 'gold-source-manifest.json'), {
    schemaVersion: 'v61-gold-source-manifest-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    status: 'CANDIDATE_SOURCE_MANIFEST_NOT_GOLD',
    targetSections: 400,
    sourceRows: verifiedRows.length,
    sectionCount: verifiedRows.reduce((sum, row) => sum + row.sectionCount, 0),
    sourceHashVerified: verifiedRows.length,
    humanReviewStatus: 'NOT_SUPPLIED',
    goldEligible: false,
    rows: verifiedRows,
  });
}

function writeMissingSourceAcquisitionPlan(source) {
  const missing = source.rows.filter(row => row.sourceStatus === 'SOURCE_MISSING');
  const mismatch = source.rows.filter(row => row.sourceStatus === 'SOURCE_HASH_MISMATCH' || row.sourceStatus === 'SOURCE_CORRUPTED');
  const grouped = new Map();
  for (const row of missing) {
    const key = [row.supplier || 'SUPPLIER_UNPROVEN', row.documentFamily || 'DOCUMENT_FAMILY_UNPROVEN', row.split || 'SPLIT_UNPROVEN'].join(' | ');
    const group = grouped.get(key) || {
      supplier: row.supplier || null,
      documentFamily: row.documentFamily || null,
      split: row.split || null,
      rowCount: 0,
      sectionCount: 0,
      sourceHashes: [],
    };
    group.rowCount += 1;
    group.sectionCount += row.sectionCount;
    if (row.sourceHash) group.sourceHashes.push(row.sourceHash);
    grouped.set(key, group);
  }
  const priorityRows = missing
    .slice()
    .sort((left, right) => right.sectionCount - left.sectionCount || left.corpusId.localeCompare(right.corpusId))
    .slice(0, source.goldGap.minimumAdditionalRowsByMetadataProjection)
    .map(row => ({
      corpusId: row.corpusId,
      sourceHash: row.sourceHash,
      expectedFilename: row.expectedSourceFilename,
      split: row.split,
      sectionCount: row.sectionCount,
      priority: 'P0_GOLD_COVERAGE_PROJECTION',
      evidenceStatus: 'SOURCE_MISSING',
      nextAction: 'Acquire original bytes through approved human/operator path; then verify SHA-256.',
    }));
  const lines = [
    '# V6.1 Missing Source Acquisition Plan',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Boundary',
    '',
    `The full corpus has ${source.counts.sourceMissing} missing source rows and ${mismatch.length} hash-mismatch/corrupted rows. This plan does not claim that all rows are needed to form a 400-section Gold; it records the full recovery queue and a metadata-only P0 coverage projection.`,
    '',
    '## Exact external inputs required',
    '',
    `- Missing original source bytes: ${source.counts.sourceMissing} rows.`,
    `- Manual reconciliation for hash-mismatch/corrupt candidates: ${mismatch.length} rows.`,
    `- Lower-bound metadata projection to reach 400 verified sections: ${source.goldGap.minimumAdditionalRowsByMetadataProjection} additional rows / ${source.goldGap.additionalVerifiedSectionsNeeded} sections.`,
    '- The lower-bound projection is not Gold evidence until each original file is supplied and hash-verified.',
    '',
    '## Priority rules',
    '',
    '- P0: sources whose metadata section count most quickly covers the remaining Gold section gap.',
    '- P1: sources needed for supplier/document-family/split diversity after P0 source verification.',
    '- P2: remaining archive recovery and duplicate-family reconciliation.',
    '',
    '## Grouped inventory',
    '',
    '| group | rows | metadata sections |',
    '|---|---:|---:|',
    ...[...grouped.entries()]
      .sort((left, right) => right[1].sectionCount - left[1].sectionCount)
      .map(([key, group]) => `| ${key.replaceAll('|', '\\|')} | ${group.rowCount} | ${group.sectionCount} |`),
    '',
    '## P0 coverage projection (not Gold)',
    '',
    '| corpus_id | expected filename | split | metadata sections |',
    '|---|---|---|---:|',
    ...priorityRows.map(row => `| ${row.corpusId} | ${String(row.expectedFilename || '').replaceAll('|', '\\|')} | ${row.split || ''} | ${row.sectionCount} |`),
    '',
    '## Required acquisition record per row',
    '',
    '- immutable original bytes',
    '- expected source hash and observed SHA-256',
    '- supplier/document family/source system/upload batch when supplied by the operator',
    '- duplicate-family decision',
    '- source location and acquisition timestamp',
    '',
    'No synthetic source, parser output, or metadata-only row may be promoted to Gold.',
  ];
  atomicWrite(join(AUDIT_DIR, 'missing-source-acquisition-plan.md'), lines.join('\n') + '\n');
}

function writeCorruptedSourceTriage(source) {
  const rows = source.rows
    .filter(row => row.sourceStatus === 'SOURCE_HASH_MISMATCH' || row.sourceStatus === 'SOURCE_CORRUPTED')
    .map(row => ({
      corpusId: row.corpusId,
      sourceHash: row.sourceHash,
      expectedFilename: row.expectedSourceFilename,
      sourceLocation: row.sourceLocation,
      observedSourceLocation: row.observedSourceLocation,
      observedHashes: row.observedHashes,
      sourceStatus: row.sourceStatus,
      classification: 'MANUAL_SOURCE_REQUIRED',
      possibleCauses: [
        'WRONG_FILE_MAPPING',
        'FILE_CHANGED_AFTER_LEDGER',
        'NEWLINE_OR_ENCODING_NORMALIZATION',
        'EXTRACTION_HASH_BINARY_HASH_MIXUP',
        'DUPLICATE_FILENAME',
        'SOURCE_REPLACED',
        'TRUNCATED_OR_CORRUPTED_FILE',
        'LEDGER_DEFECT',
      ],
      evidenceBoundary: 'A candidate file exists but no observed candidate matches the expected immutable hash; cause cannot be selected without the approved original source or operator evidence.',
      nextAction: 'Obtain original bytes or operator-confirmed lineage, then re-run hash verifier.',
      goldEligible: false,
    }));
  writeJson(join(AUDIT_DIR, 'corrupted-source-triage.json'), {
    schemaVersion: 'v61-corrupted-source-triage-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    status: rows.length === 13 ? 'COMPLETE_MACHINE_CLASSIFICATION_MANUAL_SOURCE_REQUIRED' : 'REQUIRES_RECONCILIATION',
    allowedClassifications: [
      'RECOVERABLE_MAPPING_ERROR',
      'RECOVERABLE_HASH_DEFINITION_ERROR',
      'SOURCE_REPLACED',
      'SOURCE_CORRUPTED',
      'MANUAL_SOURCE_REQUIRED',
    ],
    count: rows.length,
    rows,
  });
}

function classifyUnknownBlocker(row) {
  const evidence = row.prelabelEvidence || {};
  const blockers = [
    ...(Array.isArray(evidence.kernelBlockers) ? evidence.kernelBlockers : []),
    ...(Array.isArray(evidence.blockers) ? evidence.blockers : []),
    ...(Array.isArray(evidence.sectionBlockers) ? evidence.sectionBlockers.flat() : []),
  ].join(' ').toLowerCase();
  const dispositions = Array.isArray(evidence.sourceSalePriceDispositions)
    ? evidence.sourceSalePriceDispositions.map(value => String(value).toLowerCase())
    : [];
  const datePolicy = evidence.departureDatePolicy || {};
  if (row.sourceStatus !== 'SOURCE_VERIFIED') return 'SOURCE_MISSING';
  if (evidence.extraction && evidence.extraction.succeeded === false) return 'PARSER_DEFECT';
  if (/price|sale_price|surcharge|amount|currency/.test(blockers)
    || dispositions.some(value => !/(canonical_price_present|not_applicable|source_declared_pending)/.test(value))) return 'PRICE_AMBIGUOUS';
  if (/date|departure|past_only|excluded_past/.test(blockers)
    || Number(datePolicy.excludedPastDateCount || 0) > 0
    || Number(datePolicy.pastOnlySectionCount || 0) > 0) return 'DATE_AMBIGUOUS';
  if (/variant|option|room_type/.test(blockers)) return 'VARIANT_AMBIGUOUS';
  if (/entity|attraction|hotel|golf|airport|airline/.test(blockers)) return 'ENTITY_UNRESOLVED';
  if (row.documentClass && row.documentClass !== 'travel_product') return 'NON_PRODUCT';
  return 'TRUE_UNKNOWN';
}

function writeUnknownBlockerFinal(source) {
  const historicalRows = readJsonLines(join(AUDIT_DIR, 'unknown-blocker-triage.jsonl'))
    .filter(row => row.recordType === 'unknown_blocker_triage_item');
  const byHash = new Map(source.rows.map(row => [row.sourceHash, row]));
  const rows = historicalRows.map((historical, index) => {
    const sourceRow = byHash.get(String(historical.sourceHash || '').toLowerCase());
    const classification = sourceRow ? classifyUnknownBlocker(sourceRow) : 'TRUE_UNKNOWN';
    return {
      triageKey: historical.triageKey || `${historical.sourceHash || 'unknown'}:${index}`,
      corpusId: sourceRow?.corpusId || null,
      sourceHash: historical.sourceHash || sourceRow?.sourceHash || null,
      sectionCount: sourceRow?.sectionCount ?? historical.sectionCount ?? 0,
      sourceStatus: sourceRow?.sourceStatus || 'SOURCE_POPULATION_UNPROVEN',
      primaryClassification: classification,
      evidence: {
        sourceStatus: sourceRow?.sourceStatus || null,
        prelabelEvidence: sourceRow?.prelabelEvidence || null,
        historicalSignals: historical.signals || null,
      },
      triageStatus: 'MACHINE_TRIAGE_COMPLETE_HUMAN_REVIEW_PENDING',
      humanReviewStatus: 'NOT_HUMAN_REVIEWED',
      goldEligible: false,
      unresolvedForGold: true,
      nextAction: classification === 'SOURCE_MISSING'
        ? 'Acquire and hash-verify original source.'
        : 'Route to development fixture/review queue; do not promote to Gold.',
    };
  });
  const counts = rows.reduce((result, row) => {
    result[row.primaryClassification] = (result[row.primaryClassification] || 0) + 1;
    return result;
  }, {});
  writeJson(join(AUDIT_DIR, 'unknown-blocker-triage.json'), {
    schemaVersion: 'v61-unknown-blocker-triage-final-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    queueDefinition: 'Historical deduplicated development queue of 155 cases; not the full 1,171-row corpus and not Gold labels.',
    status: rows.length === 155 ? 'COMPLETE_MACHINE_TRIAGE_REVIEW_REQUIRED' : 'QUEUE_POPULATION_REQUIRES_RECONCILIATION',
    inputRows: rows.length,
    unknownBlockerLabelsRemaining: 0,
    classificationCounts: counts,
    allowedClassifications: [
      'SOURCE_MISSING',
      'PRICE_AMBIGUOUS',
      'DATE_AMBIGUOUS',
      'VARIANT_AMBIGUOUS',
      'ENTITY_UNRESOLVED',
      'IMAGE_UNVERIFIED',
      'NON_PRODUCT',
      'PARSER_DEFECT',
      'POLICY_DEFECT',
      'STALE_FIXTURE',
      'EXPECTED_REVIEW_REQUIRED',
      'TRUE_UNKNOWN',
    ],
    rows,
  });
  return {
    inputRows: rows.length,
    classificationCounts: counts,
    status: rows.length === 155 ? 'COMPLETE_MACHINE_TRIAGE_REVIEW_REQUIRED' : 'QUEUE_POPULATION_REQUIRES_RECONCILIATION',
  };
}

function reviewerPacketRows(source) {
  return source.rows
    .filter(row => row.sourceStatus === 'SOURCE_VERIFIED' && row.documentClass === 'travel_product')
    .map(row => ({
      packetId: 'packet:' + sha256Bytes(Buffer.from(`${row.sourceHash}:${row.lineageParent || ''}`)).slice(0, 32),
      corpusId: row.corpusId,
      sourceHash: row.sourceHash,
      lineageHash: row.lineageParent,
      immutableSourceReference: row.observedSourceLocation,
      sourceHashVerified: true,
      originalTextReference: row.observedSourceLocation,
      originalTextEmbedded: false,
      originalTextPolicy: 'Reviewer opens the immutable source reference; no synthetic or metadata-derived text is embedded.',
      normalizedTextHash: row.normalizedTextHash,
      sectionBoundaries: row.sectionId,
      sectionCount: row.sectionCount,
      tableStructure: 'REVIEWER_READS_IMMUTABLE_SOURCE',
      imageReferences: 'REVIEWER_READS_IMMUTABLE_SOURCE',
      parserCandidate: 'SUPPRESSED_FROM_BLIND_REVIEWER_VIEW',
      priceCandidate: 'SUPPRESSED_FROM_BLIND_REVIEWER_VIEW',
      departureCandidate: 'SUPPRESSED_FROM_BLIND_REVIEWER_VIEW',
      variantCandidate: 'SUPPRESSED_FROM_BLIND_REVIEWER_VIEW',
      entityCandidate: 'SUPPRESSED_FROM_BLIND_REVIEWER_VIEW',
      engineOutputsIncluded: false,
      reviewerA: 'NOT_ASSIGNED',
      reviewerB: 'NOT_ASSIGNED',
      adjudication: 'NOT_STARTED',
      goldEligible: false,
    }));
}

function writeReviewerArtifacts(source) {
  const packets = reviewerPacketRows(source);
  const packetManifest = {
    schemaVersion: 'v61-gold-review-manifest-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    status: packets.length > 0 ? 'PACKET_REFERENCES_READY_HUMAN_INPUT_REQUIRED' : 'WAITING_EXTERNAL_SOURCE',
    targetGoldSections: 400,
    sourceRows: packets.length,
    sectionCount: packets.reduce((sum, row) => sum + row.sectionCount, 0),
    packetCount: packets.length,
    engineOutputsIncluded: false,
    reviewerIndependence: {
      required: true,
      proven: false,
      reviewerA: 'NOT_ASSIGNED',
      reviewerB: 'NOT_ASSIGNED',
    },
    requiredFormFields: [
      'classification',
      'publishable',
      'adult_selling_price',
      'currency',
      'departure_dates',
      'exact_date_overrides',
      'booking_state',
      'variant_boundary',
      'hotel_relation',
      'golf_course_relation',
      'attraction_relation',
      'source_ambiguity',
      'critical_notes',
      'reviewer_confidence',
    ],
    packets,
  };
  const manifestHash = sha256Bytes(Buffer.from(JSON.stringify(packetManifest)));
  writeJson(join(AUDIT_DIR, 'gold-review-manifest.json'), { ...packetManifest, manifestHash });
  const reviewerBase = role => ({
    schemaVersion: 'v61-reviewer-ledger-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    reviewerRole: role,
    status: 'WAITING_HUMAN_INPUT',
    assigned: 0,
    completed: 0,
    invalid: 0,
    independentBlindReviewRequired: true,
    engineOutputsVisible: false,
    sourceManifestHash: manifestHash,
    packetCount: packets.length,
    sectionCount: packets.reduce((sum, row) => sum + row.sectionCount, 0),
    reviewResults: [],
    humanEvidenceRequired: true,
  });
  writeJson(join(AUDIT_DIR, 'reviewer-a-ledger.json'), reviewerBase('A'));
  writeJson(join(AUDIT_DIR, 'reviewer-b-ledger.json'), reviewerBase('B'));
  writeJson(join(AUDIT_DIR, 'adjudication-ledger.json'), {
    schemaVersion: 'v61-adjudication-ledger-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    sourceManifestHash: manifestHash,
    status: 'READY_FOR_REVIEW_RESULT_IMPORT',
    disagreementRequiredRemaining: null,
    criticalUnresolved: null,
    adjudicatorIndependenceRequired: true,
    adjudicatorEvidence: [],
    finalGroundTruth: [],
    humanEvidenceRequired: true,
  });
  return { packets, manifestHash };
}

function writeOperationalPlans(source, catalog, production, inventory) {
  atomicWrite(join(AUDIT_DIR, 'production-canary-plan.md'), [
    '# V6.1 Production Canary Plan (Prepared, Not Executed)',
    '',
    '- Production execution: **NOT AUTHORIZED**',
    '- Auto-publish: **OFF**',
    '- Database writes: **0**',
    '- Pointer changes: **0**',
    '',
    '## Sequence',
    '',
    '1. One manually approved product in a non-production or explicitly approved canary scope.',
    '2. Three products with exact source/revision/snapshot/proof binding.',
    '3. Ten products after cache, browser proof, rollback, CAS, and fencing evidence pass.',
    '4. Supplier/parser cohort only after Gold certificate and live stability gates.',
    '',
    '## Required owner gate',
    '',
    `- Approval sentinel: \`${CANARY_APPROVAL_SENTINEL}\``,
    `- Manifest: \`production-rollout-manifest.json\``,
    `- Current manifest hash: \`${production.manifestHash}\``,
    '- This plan must not be interpreted as execution evidence.',
    '',
  ].join('\n'));

  const classRows = recoverabilityClass => inventory
    .filter(row => row.recoverability_class === recoverabilityClass)
    .map(row => ({
      productKey: row.product_key,
      catalogProductKey: row.catalog_product_key,
      recoverabilityClass: row.recoverability_class,
      packageStatus: row.package_status,
      publicationState: row.publication_state,
      sourceHashVerified: row.source_hash_verified === true,
      lineageHashVerified: row.lineage_hash_verified === true,
      sourceDocumentBound: row.source_document_bound === true,
      currentRevision: row.revision_id || row.current_revision || null,
      customerPointerState: row.customer_pointer_state,
      plannedAction: recoverabilityClass === 'A_SOURCE_AND_LINEAGE_READY'
        ? 'FREE_REHEARSAL_DRY_RUN_TYPED_IR_REVISION_SNAPSHOT_PROOF_DIFF_ONLY'
        : recoverabilityClass === 'B_PARTIAL_OR_REVIEW'
          ? 'SOURCE_DIFF_REVIEW_AND_LINEAGE_REPAIR_REQUIRED'
          : 'SOURCE_REUPLOAD_REQUEST_SAFE_UNDER_REVIEW',
      executionStatus: 'NOT_EXECUTED',
    }));
  const classA = classRows('A_SOURCE_AND_LINEAGE_READY');
  const classB = classRows('B_PARTIAL_OR_REVIEW');
  const classC = classRows('C_NO_V6_SOURCE_BINDING');
  const canaryCandidates = classA
    .slice()
    .sort((left, right) => left.productKey.localeCompare(right.productKey));
  writeJson(join(AUDIT_DIR, 'production-canary-candidates.json'), {
    schemaVersion: 'v61-production-canary-candidates-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    status: 'SELECTED_FOR_REHEARSAL_NOT_EXECUTED',
    cohorts: {
      one: canaryCandidates.slice(0, 1),
      three: canaryCandidates.slice(0, 3),
      ten: canaryCandidates.slice(0, 10),
    },
    selectionRule: 'Class A source-and-lineage-ready inventory, sorted by pseudonymous product key; no production mutation.',
  });
  const inventoryRows = inventory.map(row => ({
    productKey: row.product_key,
    catalogProductKey: row.catalog_product_key,
    recoverabilityClass: row.recoverability_class,
    packageStatus: row.package_status,
    publicationState: row.publication_state,
    sourceHashVerified: row.source_hash_verified === true,
    lineageHashVerified: row.lineage_hash_verified === true,
    sourceDocumentBound: row.source_document_bound === true,
    customerPointerState: row.customer_pointer_state,
    plannedDisposition: row.recoverability_class === 'C_NO_V6_SOURCE_BINDING'
      ? 'SAFE_UNDER_REVIEW_NO_CUSTOMER_FACTS'
      : row.recoverability_class === 'A_SOURCE_AND_LINEAGE_READY'
        ? 'FREE_REHEARSAL_DRY_RUN_THEN_APPROVED_MANUAL_GATE'
        : 'SOURCE_DIFF_REVIEW_REQUIRED',
    executionStatus: 'NOT_EXECUTED',
  }));
  writeJson(join(AUDIT_DIR, 'product-recovery-inventory.json'), {
    schemaVersion: 'v61-product-recovery-inventory-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    source: 'read-only production aggregate inventory',
    total: inventoryRows.length,
    classCounts: { A: classA.length, B: classB.length, C: classC.length },
    actualWrites: 0,
    pointerChanges: 0,
    rows: inventoryRows,
  });
  writeJson(join(AUDIT_DIR, 'product-source-linkage.json'), {
    schemaVersion: 'v61-product-source-linkage-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    source: 'read-only production aggregate inventory',
    rows: inventory.map(row => ({
      productKey: row.product_key,
      sourceDocumentBound: row.source_document_bound === true,
      sourceHashVerified: row.source_hash_verified === true,
      lineageHashVerified: row.lineage_hash_verified === true,
      sourceStatus: row.source_status || null,
      recoverabilityClass: row.recoverability_class,
      linkageDecision: row.recoverability_class === 'A_SOURCE_AND_LINEAGE_READY'
        ? 'SOURCE_AND_LINEAGE_PROVEN_FOR_DRY_RUN'
        : row.recoverability_class === 'B_PARTIAL_OR_REVIEW'
          ? 'PARTIAL_OR_REVIEW_REQUIRED'
          : 'SOURCE_MAPPING_UNPROVEN',
    })),
  });
  writeJsonLines(join(AUDIT_DIR, 'class-a-recompile-manifest.jsonl'), [
    { recordType: 'manifest', status: 'FREE_REHEARSAL_DRY_RUN_NOT_EXECUTED', count: classA.length },
    ...classA,
  ]);
  writeJsonLines(join(AUDIT_DIR, 'class-b-review-manifest.jsonl'), [
    { recordType: 'manifest', status: 'REVIEW_REQUIRED_NOT_EXECUTED', count: classB.length },
    ...classB,
  ]);
  writeJsonLines(join(AUDIT_DIR, 'class-c-source-request-manifest.jsonl'), [
    { recordType: 'manifest', status: 'SOURCE_REQUEST_ONLY_NOT_EXECUTED', count: classC.length },
    ...classC,
  ]);
  writeJson(join(AUDIT_DIR, 'rollback-manifest.json'), {
    schemaVersion: 'v61-recovery-rollback-manifest-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    status: 'PREPARED_NOT_EXECUTED',
    rollbackRequiredBeforePublication: true,
    pointerChanges: 0,
    actions: [
      'stop the active canary',
      'restore the prior customer pointer using CAS and fencing',
      'verify snapshot and browser proof against the prior revision',
      'record rollback evidence before any retry',
    ],
  });
  writeJson(join(AUDIT_DIR, 'production-write-manifest.json'), {
    schemaVersion: 'v61-production-write-manifest-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    status: 'NOT_AUTHORIZED_NOT_EXECUTED',
    laneAApproval: CANARY_APPROVAL_SENTINEL,
    laneBApproval: RECOVERY_APPROVAL_SENTINEL,
    plannedWrites: { productionRows: 0, customerPointers: 0, globalFreezeChanges: 0 },
    selectedExistingProducts: { total: inventory.length, classA: classA.length, classB: classB.length, classC: classC.length },
    productionWriteAllowed: false,
    note: 'This manifest is an approval packet input, not an execution command or evidence of mutation.',
  });
  atomicWrite(join(AUDIT_DIR, 'production-owner-approval-packet.md'), [
    '# Lane A Production Canary Owner Approval Packet',
    '',
    '- Status: **READY_FOR_OWNER_APPROVAL / NOT_EXECUTED**',
    `- Required approval: \`${CANARY_APPROVAL_SENTINEL}\``,
    `- Production project manifest: \`production-rollout-manifest.json\``,
    `- Canary candidate manifest: \`production-canary-candidates.json\``,
    `- Manifest hash: \`${production.manifestHash}\``,
    '- Planned canary sequence: 1 product → 3 products → 10 products',
    '- Production row writes performed: 0',
    '- Customer pointer changes performed: 0',
    '- Auto-publish: OFF',
    '',
    '## Required packet fields before execution',
    '',
    '- selected product IDs and current revisions',
    '- candidate revisions and source lineage hashes',
    '- snapshot/proof references',
    '- rollback revisions and CAS/fencing tokens',
    '- expected customer URLs and impact scope',
    '- monitoring queries, abort criteria, browser proof, and CDN convergence proof',
    '- exact execution and rollback commands approved by the owner',
    '',
    'No production execution is implied by this packet.',
    '',
  ].join('\n'));
  atomicWrite(join(AUDIT_DIR, 'existing-product-owner-approval-packet.md'), [
    '# Lane B Existing Product Recovery Owner Approval Packet',
    '',
    '- Status: **READY_FOR_OWNER_APPROVAL / NOT_EXECUTED**',
    `- Required approval: \`${RECOVERY_APPROVAL_SENTINEL}\``,
    `- Inventory: ${inventory.length} products (A ${classA.length} / B ${classB.length} / C ${classC.length})`,
    '- Planned production row writes: 0 until separate approval is supplied',
    '- Planned pointer changes: 0 until separate approval is supplied',
    '',
    '## Execution boundary',
    '',
    '- A: free-rehearsal dry-run only, then source/revision/snapshot/proof gate.',
    '- B: source diff and lineage review before any publication decision.',
    '- C: source re-upload request and `SAFE_UNDER_REVIEW`; no customer facts.',
    '- Existing rows are never directly repaired; new revision/snapshot/proof/CAS flow is required.',
    '',
    'No production execution is implied by this packet.',
    '',
  ].join('\n'));
  writeJson(join(AUDIT_DIR, 'production-canary-evidence.json'), {
    schemaVersion: 'v61-production-canary-evidence-2',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    status: 'NOT_RUN',
    approvalReceived: production.approvalValid,
    requiredApproval: CANARY_APPROVAL_SENTINEL,
    stages: [],
    browser390x844Evidence: 'NOT_RUN',
    cdnConvergenceEvidence: 'NOT_RUN',
    rollbackEvidence: 'NOT_RUN',
    pointerMutationCount: 0,
    productionDatabaseMutationCount: 0,
    reason: 'Production rollout is outside the read-only preparation boundary and requires the exact Lane A approval.',
  });
  writeJsonLines(join(AUDIT_DIR, 'existing-product-recompile-results.jsonl'), [{
    recordType: 'recompile_run_summary',
    status: 'DRY_RUN_NOT_EXECUTED',
    selectedPackages: inventory.length,
    classA: classA.length,
    classB: classB.length,
    classC: classC.length,
    typedIrRevisionSnapshotProof: 'NOT_RUN',
    mutatedPackages: 0,
    publishedPointersChanged: 0,
    underReviewWrites: 0,
    automaticPublicationEnabled: false,
    reason: 'Only a read-only manifest was produced; Free rehearsal DB execution and production execution were not requested in this run.',
  }]);

  atomicWrite(join(AUDIT_DIR, 'existing-product-recompile-plan.md'), [
    '# Existing Product V6.1 Recompile Plan (Prepared, Not Executed)',
    '',
    `- Inventory rows: ${catalog.total}`,
    `- Class A exact source/lineage ready: ${catalog.classA}`,
    `- Class B partial/review: ${catalog.classB}`,
    `- Class C source missing: ${catalog.classC}`,
    `- Actual production writes: 0`,
    `- Pointer changes: 0`,
    '',
    '## Dispositions',
    '',
    '- A: manual source/revision/proof gate, then validated publication only after owner approval.',
    '- B: resolve missing lineage or human review before any publication decision.',
    '- C: route to `SAFE_UNDER_REVIEW`; do not fetch or expose customer snapshot facts.',
    '',
    'This is a read-only plan. Legacy tables are not treated as V6.1 customer authority.',
    '',
  ].join('\n'));
}

function writeBenchmarkAndCertificate(source, gold, reviewerArtifacts) {
  const benchmark = {
    schemaVersion: 'v61-gold-benchmark-result-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    status: 'NOT_RUN',
    reason: 'Immutable 400-section Gold freeze, dual blind review, and adjudication are not complete.',
    goldSections: 0,
    metrics: {
      criticalFalsePublish: null,
      criticalFalseReview: null,
      priceExactMatch: null,
      departureExactMatch: null,
      currencyMatch: null,
      exactDateOverrideMatch: null,
      variantMatch: null,
      entityResolution: null,
      malformedPriceAutoCorrection: null,
      fuzzyEntityAutoApproval: null,
      supplierRawLeakage: null,
      nonProductFalseRegistration: null,
      positivePathRecall: null,
    },
    runner: {
      source: 'scripts/run-product-registration-95-benchmark.ts',
      reviewedBenchmarkSealer: 'scripts/seal-product-registration-reviewed-benchmark.ts',
      reviewManifestHash: reviewerArtifacts.manifestHash,
    },
  };
  writeJson(join(AUDIT_DIR, 'gold-benchmark-result.json'), benchmark);
  writeJson(join(AUDIT_DIR, 'gold-certificate-NOT-ISSUED.json'), {
    schemaVersion: 'v61-gold-certificate-not-issued-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    decision: 'NOT_ISSUED',
    certificateIssued: false,
    conditions: {
      finalSectionCount: { required: 400, observed: 0, pass: false },
      sourceHashVerified: { required: 400, observed: source.verifiedSourceSections, pass: false },
      reviewerAComplete: { required: 400, observed: gold.reviewerA.count, pass: false },
      reviewerBComplete: { required: 400, observed: gold.reviewerB.count, pass: false },
      reviewerIndependenceProven: { required: true, observed: false, pass: false },
      adjudicationRequiredRemaining: { required: 0, observed: null, pass: false },
      criticalUnresolved: { required: 0, observed: null, pass: false },
      priceGroundTruthComplete: { required: 400, observed: 0, pass: false },
      departureGroundTruthComplete: { required: 400, observed: 0, pass: false },
    },
    reason: 'External original source and independent human review evidence are not available; no Gold completion was fabricated.',
  });
}

function resumeVerifier(source, gold, reviewerArtifacts, production, requireLaneStatus = true) {
  const requiredFiles = [
    'gold-population-final.json',
    'source-reconciliation-final.json',
    'missing-source-acquisition-plan.md',
    'corrupted-source-triage.json',
    'unknown-blocker-triage.json',
    'reviewer-a-ledger.json',
    'reviewer-b-ledger.json',
    'adjudication-ledger.json',
    'gold-source-manifest.json',
    'gold-review-manifest.json',
    'gold-benchmark-result.json',
    'gold-certificate-NOT-ISSUED.json',
    'production-canary-plan.md',
    'production-canary-candidates.json',
    'existing-product-recompile-plan.md',
    'product-recovery-inventory.json',
    'product-source-linkage.json',
    'class-a-recompile-manifest.jsonl',
    'class-b-review-manifest.jsonl',
    'class-c-source-request-manifest.jsonl',
    'rollback-manifest.json',
    'production-write-manifest.json',
    'production-owner-approval-packet.md',
    'existing-product-owner-approval-packet.md',
    'run-state.json',
  ];
  if (requireLaneStatus) requiredFiles.push('lane-status.json');
  const missing = requiredFiles.filter(file => !existsSync(join(AUDIT_DIR, file)));
  const sourcePopulationPass = source.rows.length === source.counts.corpusEntries
    && source.counts.sourceHashVerified + source.counts.sourceCorrupt + source.counts.sourceMissing === source.counts.corpusEntries;
  const packetManifestPass = reviewerArtifacts.packets.length === source.rows.filter(row => row.sourceStatus === 'SOURCE_VERIFIED' && row.documentClass === 'travel_product').length;
  const noMutationPass = production.productionWriteCount === 0 && production.pointerChanges === 0;
  const laneStatus = readJson(join(AUDIT_DIR, 'lane-status.json'), null);
  const laneSchemaPass = requireLaneStatus
    ? Boolean(
      laneStatus
        && laneStatus.lanes
        && Object.keys(laneStatus.lanes).length === 4
        && laneStatus.overall
        && typeof laneStatus.overall.state === 'string',
    )
    : true;
  const pass = missing.length === 0 && sourcePopulationPass && packetManifestPass && noMutationPass && laneSchemaPass;
  const result = {
    schemaVersion: 'v61-resume-verifier-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    pass,
    checks: {
      requiredFiles: { pass: missing.length === 0, missing },
      sourcePopulationReconciliation: { pass: sourcePopulationPass, rows: source.rows.length, corpusEntries: source.counts.corpusEntries },
      packetManifestMatchesVerifiedTravelRows: { pass: packetManifestPass, packets: reviewerArtifacts.packets.length },
      productionMutationGuard: { pass: noMutationPass, writes: production.productionWriteCount, pointerChanges: production.pointerChanges },
      laneStateMachine: { pass: laneSchemaPass, laneCount: laneStatus?.lanes ? Object.keys(laneStatus.lanes).length : 0 },
      approvalSentinelNotReceived: { pass: production.approvalValid === false, sentinel: CANARY_APPROVAL_SENTINEL },
    },
    resumeCommand: 'npm run v61:finalize -- --resume',
  };
  writeJson(join(AUDIT_DIR, 'resume-verifier.json'), result);
  return result;
}

function writeFinalGateReport(source, gold, production, catalog, triage, verifier, reviewerArtifacts, laneSummary) {
  const externalInputs = [
    `${source.counts.sourceMissing} original source files with exact hash verification`,
    `${source.counts.sourceCorrupt} hash-mismatch source cases requiring manual reconciliation`,
    'Reviewer A independent results for 400 Gold sections',
    'Reviewer B independent results for 400 Gold sections',
    'Adjudicator results for every A/B disagreement and critical price/date mismatch',
    `Owner approval for Lane A: ${CANARY_APPROVAL_SENTINEL}`,
    `Owner approval for Lane B: ${RECOVERY_APPROVAL_SENTINEL}`,
  ];
  atomicWrite(join(AUDIT_DIR, 'final-gate-report.md'), [
    '# V6.1 GOAL MODE FINAL GATE REPORT',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Final state',
    '',
    `- Overall: \`${laneSummary.overall.state}\``,
    `- Completion target: \`${laneSummary.overall.completionTarget}\``,
    '- Internal preparation: complete',
    '- Gold certificate: not issued',
    '- Production rollout: not executed',
    '',
    '## Independent lanes',
    '',
    ...Object.values(laneSummary.lanes).flatMap(lane => [
      `### ${lane.id}`,
      '',
      `- state: \`${lane.state}\``,
      `- preparation: ${lane.preparationComplete ? 'complete' : 'incomplete'}`,
      `- next action: ${lane.nextAction}`,
      ...(lane.blockers.length > 0 ? [`- blockers: ${lane.blockers.join('; ')}`] : []),
      '',
    ]),
    'A waiting lane does not terminate the other lanes. The controller continues machine-safe preparation and resumes from this ledger when the corresponding external input arrives.',
    '',
    '## Evidence',
    '',
    `- Corpus population: ${source.counts.corpusEntries}`,
    `- Source hash verified: ${source.counts.sourceHashVerified}`,
    `- Source missing: ${source.counts.sourceMissing}`,
    `- Hash mismatch/corrupt: ${source.counts.sourceCorrupt}`,
    `- Gold sections verified from available sources: ${source.verifiedSourceSections}`,
    `- Metadata-only lower-bound additional rows for 400 sections: ${source.goldGap.minimumAdditionalRowsByMetadataProjection}`,
    `- UNKNOWN_BLOCKER triage rows classified: ${triage.inputRows}`,
    `- Reviewer packet references prepared: ${reviewerArtifacts.packets.length}`,
    `- Reviewer A/B completed: ${gold.reviewerA.count}/${gold.reviewerB.count}`,
    `- Adjudication: not run`,
    `- Resume verifier: ${verifier.pass ? 'PASS' : 'FAIL'}`,
    `- Machine actions remaining: ${laneSummary.overall.machineActionsRemaining ? 'yes' : 'no'}`,
    `- External inputs only: ${laneSummary.overall.externalInputsOnly ? 'yes' : 'no'}`,
    `- Production writes/pointer changes: ${production.productionWriteCount}/${production.pointerChanges}`,
    `- Production manifest: ${production.status} (${production.manifestHash})`,
    '',
    '## Exact external inputs still required',
    '',
    ...externalInputs.map(item => `- ${item}`),
    '',
    'These inputs cannot be generated by the system without violating source immutability, production approval, or human-review independence. No synthetic source, AI-generated reviewer result, or fabricated adjudication was used.',
    '',
    '## Operational safety',
    '',
    '- auto-publish: OFF',
    '- production DB write: forbidden and not performed',
    '- customer pointer mutation: forbidden and not performed',
    '- production domain/deployment/freeze change: not performed',
    '',
  ].join('\n'));
}

function reviewRecords(role) {
  const directory = join(ROOT, 'gold-review', 'results', role);
  if (!existsSync(directory)) return { count: 0, invalid: 0, reviewerIds: [] };
  const files = [];
  const seen = new Set();
  walkFiles(directory, files, seen, new Set(['.json', '.jsonl', '.csv']));
  let count = 0;
  let invalid = 0;
  const reviewerIds = new Set();
  for (const filePath of files) {
    if (!['.json', '.jsonl', '.csv'].includes(extname(filePath).toLowerCase())) continue;
    if (extname(filePath).toLowerCase() === '.csv') continue;
    const records = extname(filePath).toLowerCase() === '.jsonl'
      ? readJsonLines(filePath)
      : [readJson(filePath, null)].filter(Boolean);
    for (const record of records) {
      const reviewerId = record.reviewer_id || record.reviewerId;
      if (!reviewerId || record.source_hash === undefined && record.sourceHash === undefined) {
        invalid += 1;
        continue;
      }
      count += 1;
      reviewerIds.add(String(reviewerId));
    }
  }
  return { count, invalid, reviewerIds: [...reviewerIds] };
}

function goldProgress(source) {
  const reviewerA = reviewRecords('reviewer-a');
  const reviewerB = reviewRecords('reviewer-b');
  const sourceReady = source.counts.sourceHashVerified;
  const sourceSections = source.verifiedSourceSections;
  const goldSourceReady = sourceReady >= 400 && sourceSections >= 400;
  const reviewerReady = reviewerA.count >= 400 && reviewerB.count >= 400;
  const sameReviewer = reviewerA.reviewerIds.some(id => reviewerB.reviewerIds.includes(id));
  const status = source.counts.sourceMissing > 0
    ? 'WAITING_EXTERNAL_SOURCE'
    : !reviewerReady
      ? 'WAITING_HUMAN_REVIEW'
      : 'WAITING_ADJUDICATION';
  return {
    status,
    targetSections: 400,
    reserveSections: 50,
    sourceHashVerifiedRows: sourceReady,
    sourceHashVerifiedSections: sourceSections,
    frozenCandidateSections: source.currentCandidate.frozenSections,
    sourceMissingRows: source.counts.sourceMissing,
    currentCandidate: source.currentCandidate,
    reviewerA: { count: reviewerA.count, invalid: reviewerA.invalid },
    reviewerB: { count: reviewerB.count, invalid: reviewerB.invalid },
    sameReviewerDetected: sameReviewer,
    goldQualifiedSections: goldSourceReady && reviewerReady ? 400 : 0,
    certificateIssued: false,
  };
}

function productionState() {
  const readiness = readJson(join(AUDIT_DIR, 'production-readiness.json'), {});
  const manifestPath = join(AUDIT_DIR, 'production-rollout-manifest.json');
  const migrationList = Array.isArray(readiness.requiredV61Migrations) ? readiness.requiredV61Migrations : [];
  const migrationsPresent = migrationList.filter(item => item.productionPresent === true).length;
  const objectPresence = readiness.v61ObjectPresence || {};
  const prerequisitesReady = migrationsPresent === migrationList.length
    && Number(objectPresence.present || 0) >= Number(objectPresence.required || 0);
  const approvalPath = join(AUDIT_DIR, 'approvals', 'production-rollout.json');
  const approval = readJson(approvalPath, null);
  const existingManifest = readJson(manifestPath, null);
  const stableManifestSeed = JSON.stringify({
    productionProjectRef: readiness.projectRef || null,
    migrations: migrationList.map(item => ({ path: item.path, sha256: item.sha256 })),
    v61ObjectRequired: Number(objectPresence.required || 0),
  });
  const stableManifestId = 'v61-production-rollout-' + sha256Bytes(Buffer.from(stableManifestSeed)).slice(0, 16);
  const approvalValid = Boolean(
    approval
      && approval.approval === CANARY_APPROVAL_SENTINEL
      && approval.manifest_hash
      && existingManifest
      && approval.manifest_hash === existingManifest.manifestHash,
  );
  const manifestBase = {
    schemaVersion: 'v61-production-rollout-manifest-controller-1',
    manifestId: stableManifestId,
    productionProjectRef: readiness.projectRef || null,
    expectedSchemaFingerprint: {
      v61MigrationsRequired: migrationList.map(item => item.path),
      v61MigrationsPresent: migrationsPresent,
      v61ObjectPresent: Number(objectPresence.present || 0),
      v61ObjectRequired: Number(objectPresence.required || 0),
    },
    plannedWrites: [
      'V6.1 migrations only after owner approval',
      '1->3->10 canary records only after migration and approval',
    ],
    rollbackActions: ['stop canary', 'restore previous pointer/freeze state using approved rollback procedure'],
    cachePlan: 'NOT_RUN',
    verificationQueries: ['schema fingerprint', 'authority config', 'pointer binding', 'proof and convergence'],
    approval: {
      required: CANARY_APPROVAL_SENTINEL,
      received: approvalValid,
      approvalFile: relative(ROOT, approvalPath).replaceAll('\\', '/'),
    },
    productionWriteCount: 0,
    pointerChanges: 0,
    status: prerequisitesReady
      ? (approvalValid ? 'APPROVAL_PRESENT_NOT_EXECUTED' : 'WAITING_OWNER_APPROVAL')
      : 'BLOCKED_PREREQUISITE',
    executed: false,
  };
  const manifestHash = sha256Bytes(Buffer.from(JSON.stringify(manifestBase)));
  const manifest = { ...manifestBase, manifestHash };
  writeJson(manifestPath, manifest);
  return {
    prerequisitesReady,
    approvalValid,
    status: manifest.status,
    manifestHash,
    productionWriteCount: 0,
    pointerChanges: 0,
    executed: false,
    manualCanaryComplete: false,
  };
}

function updateTextReport(source, catalog, gold, production, nextAction, laneSummary) {
  const reportPath = join(AUDIT_DIR, 'final-executive-report.md');
  const existing = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '# V6.1 Finalization\n';
  const start = '<!-- v61-controller-latest:start -->';
  const end = '<!-- v61-controller-latest:end -->';
  const block = [
    start,
    '',
    '## Latest controller run',
    '',
    '- run_id: ' + RUN_ID,
    '- controller_state: ' + nextAction.state,
    '- source hash-verified rows: ' + source.counts.sourceHashVerified,
    '- source missing rows: ' + source.counts.sourceMissing,
    '- existing catalog inventory: ' + catalog.total,
    '- class A/B/C: ' + catalog.classA + '/' + catalog.classB + '/' + catalog.classC,
    '- reviewer A/B records: ' + gold.reviewerA.count + '/' + gold.reviewerB.count,
    '- Gold certificate: NOT_ISSUED',
    '- production writes: 0',
    '- production pointer changes: 0',
    '- production manifest: ' + production.status,
    '- lane A/B/C/D: ' + [
      laneSummary.lanes.productionManualRollout,
      laneSummary.lanes.existingProductRecovery,
      laneSummary.lanes.goldSourceAcquisition,
      laneSummary.lanes.humanDualReview,
    ].map(lane => lane.state).join(' / '),
    '',
    'Next action: ' + nextAction.description,
    '',
    end,
  ].join('\n');
  const marker = new RegExp(start + '[\\s\\S]*?' + end, 'u');
  const next = marker.test(existing) ? existing.replace(marker, block) : existing.replace(/\s*$/u, '') + '\n\n' + block + '\n';
  atomicWrite(reportPath, next);
}

function buildLaneSummary(source, gold, production, catalog, verifier, reviewerArtifacts) {
  const productionLane = {
    id: LANE_IDS.productionManualRollout,
    state: production.prerequisitesReady && production.approvalValid ? 'RUNNING' : 'WAITING_OWNER_APPROVAL',
    preparationComplete: verifier.pass,
    executionGate: production.approvalValid ? 'APPROVAL_PRESENT_NOT_EXECUTED' : 'OWNER_APPROVAL_REQUIRED',
    progress: {
      requiredMigrations: 4,
      observedMigrations: production.prerequisitesReady ? 4 : 0,
      requiredObjects: 6,
      observedObjects: production.prerequisitesReady ? 6 : 0,
      productionWrites: production.productionWriteCount,
      pointerChanges: production.pointerChanges,
    },
    blockers: [
      ...(production.prerequisitesReady ? [] : ['PRODUCTION_PREREQUISITES_NOT_READY']),
      ...(production.approvalValid ? [] : ['APPROVAL_SENTINEL_NOT_RECEIVED:' + CANARY_APPROVAL_SENTINEL]),
    ],
    nextAction: production.prerequisitesReady && production.approvalValid
      ? 'Execute the approved 1→3→10 manual canary through the separately authorized production gate; no execution has occurred.'
      : 'Keep production untouched; resolve the production prerequisite manifest and provide the exact owner approval sentinel before any write.',
    externalInput: production.prerequisitesReady && production.approvalValid ? null : {
      type: 'OWNER_APPROVAL_AND_PRODUCTION_PREREQUISITE',
      sentinel: CANARY_APPROVAL_SENTINEL,
      productionWritesAllowed: false,
    },
  };

  const recoveryLane = {
    id: LANE_IDS.existingProductRecovery,
    state: 'WAITING_OWNER_APPROVAL',
    preparationComplete: verifier.pass && catalog.total === 993,
    executionGate: 'PLAN_READY_NOT_EXECUTED',
    progress: {
      inventoryTotal: catalog.total,
      classA: catalog.classA,
      classB: catalog.classB,
      classC: catalog.classC,
      validatedPublished: 0,
      safeUnderReview: 0,
      planRows: catalog.total,
    },
    blockers: [
      'RECOVERY_PLAN_REQUIRES_APPROVED_PRODUCTION_EXECUTION',
      'CLASS_C_REQUIRES_SOURCE_BEFORE_CUSTOMER_FACTS',
    ],
    nextAction: 'Use the prepared class A/B/C manifests for an explicitly approved execution session; leave all 993 products unmodified in this session.',
    externalInput: {
      type: 'OWNER_APPROVAL_FOR_EXISTING_PRODUCT_RECOVERY',
      sentinel: RECOVERY_APPROVAL_SENTINEL,
      productionWritesAllowed: false,
    },
  };

  const sourceReadySections = source.verifiedSourceSections;
  const sourceLane = {
    id: LANE_IDS.goldSourceAcquisition,
    state: sourceReadySections >= 400 ? 'PASS' : 'WAITING_EXTERNAL_SOURCE',
    preparationComplete: verifier.pass,
    executionGate: sourceReadySections >= 400 ? 'SOURCE_CAPACITY_READY_FOR_REVIEW' : 'SOURCE_ACQUISITION_REQUIRED',
    progress: {
      targetSections: 400,
      reserveSections: gold.reserveSections,
      targetPlusReserve: 400 + gold.reserveSections,
      verifiedSections: sourceReadySections,
      additionalVerifiedSectionsNeeded: source.goldGap.additionalVerifiedSectionsNeeded,
      additionalVerifiedSectionsNeededWithReserve: Math.max(0, 400 + gold.reserveSections - sourceReadySections),
      verifiedRows: source.counts.sourceHashVerified,
      missingRows: source.counts.sourceMissing,
      hashMismatchOrCorruptRows: source.counts.sourceCorrupt,
      projectedAdditionalRowsNotGold: source.goldGap.minimumAdditionalRowsByMetadataProjection,
    },
    blockers: sourceReadySections >= 400
      ? []
      : [
        'SOURCE_MISSING:' + source.counts.sourceMissing,
        'SOURCE_HASH_MISMATCH_OR_CORRUPT:' + source.counts.sourceCorrupt,
        'GOLD_SECTION_GAP:' + source.goldGap.additionalVerifiedSectionsNeeded,
      ],
    nextAction: sourceReadySections >= 400
      ? 'Source capacity is ready; hand the verified candidate set to the independent human-review lane.'
      : 'Acquire approved original bytes for the P0 coverage queue, verify each SHA-256, and resume; metadata projections are not Gold evidence.',
    externalInput: sourceReadySections >= 400 ? null : {
      type: 'ORIGINAL_SOURCE_BYTES',
      minimumProjectedRows: source.goldGap.minimumAdditionalRowsByMetadataProjection,
      minimumVerifiedSections: source.goldGap.additionalVerifiedSectionsNeeded,
      fullMissingRows: source.counts.sourceMissing,
    },
  };

  const reviewerAComplete = gold.reviewerA.count >= 400;
  const reviewerBComplete = gold.reviewerB.count >= 400;
  const reviewLane = {
    id: LANE_IDS.humanDualReview,
    state: reviewerAComplete && reviewerBComplete ? 'RUNNING' : 'WAITING_HUMAN_REVIEW',
    preparationComplete: verifier.pass && reviewerArtifacts.packets.length > 0,
    executionGate: reviewerAComplete && reviewerBComplete ? 'ADJUDICATION_READY' : 'PACKETS_READY_HUMAN_INPUT_REQUIRED',
    progress: {
      packetRows: reviewerArtifacts.packets.length,
      packetSections: reviewerArtifacts.packets.reduce((sum, row) => sum + Number(row.sectionCount || 0), 0),
      reviewerA: gold.reviewerA.count,
      reviewerB: gold.reviewerB.count,
      adjudicationComplete: false,
      reviewerIndependenceProven: false,
    },
    blockers: [
      ...(reviewerAComplete ? [] : ['REVIEWER_A_PENDING:' + gold.reviewerA.count + '/400']),
      ...(reviewerBComplete ? [] : ['REVIEWER_B_PENDING:' + gold.reviewerB.count + '/400']),
      'HUMAN_INDEPENDENCE_MUST_BE_PROVEN',
    ],
    nextAction: reviewerAComplete && reviewerBComplete
      ? 'Import A/B disagreement packets and complete adjudication without overwriting either reviewer record.'
      : 'Assign independent Reviewer A and Reviewer B to the prepared blind packets; import their signed results with source hashes.',
    externalInput: {
      type: 'INDEPENDENT_HUMAN_REVIEW_RESULTS',
      reviewerARequired: 400,
      reviewerBRequired: 400,
      reviewerACompleted: gold.reviewerA.count,
      reviewerBCompleted: gold.reviewerB.count,
    },
  };

  const lanes = {
    productionManualRollout: productionLane,
    existingProductRecovery: recoveryLane,
    goldSourceAcquisition: sourceLane,
    humanDualReview: reviewLane,
  };
  const safetyFailure = production.productionWriteCount !== 0
    || production.pointerChanges !== 0
    || production.approvalValid && production.status === 'EXECUTED'
    || false;
  const machineActionsRemaining = !verifier.pass
    || Object.values(lanes).some(lane => lane.state === 'RUNNING');
  const manualOnlyReady = Boolean(
    production.prerequisitesReady
      && production.approvalValid
      && production.executed === true
      && production.manualCanaryComplete === true,
  );
  const autoPublishReady = Boolean(gold.certificateIssued === true && gold.goldQualifiedSections >= 400);
  const completionTarget = autoPublishReady
    ? 'FINAL_COMPLETE_AUTOPUBLISH_READY'
    : manualOnlyReady
      ? 'FINAL_COMPLETE_MANUAL_ONLY'
      : 'NOT_COMPLETE';
  let state = 'WAITING_EXTERNAL_INPUTS';
  let description = 'All safe machine preparation is complete; independent lanes are waiting on their own external inputs.';
  if (safetyFailure) {
    state = 'FAIL_SAFETY';
    description = 'A production mutation safety invariant was observed; stop and investigate before resuming.';
  } else if (autoPublishReady) {
    state = 'FINAL_COMPLETE_AUTOPUBLISH_READY';
    description = 'Gold certification and all automatic-publication benchmark gates are complete.';
  } else if (manualOnlyReady) {
    state = 'FINAL_COMPLETE_MANUAL_ONLY';
    description = 'Manual production rollout completion gates are complete; automatic publication remains separately disabled.';
  } else if (machineActionsRemaining) {
    state = 'RUNNING';
    description = 'At least one lane still has safe machine-executable work; continue without waiting for unrelated external inputs.';
  }
  return {
    lanes,
    overall: {
      state,
      description,
      completionTarget,
      machineActionsRemaining,
      externalInputsOnly: !machineActionsRemaining && !safetyFailure && state === 'WAITING_EXTERNAL_INPUTS',
      waitingLanes: Object.values(lanes)
        .filter(lane => lane.state.startsWith('WAITING_'))
        .map(lane => lane.id),
    },
  };
}

function run() {
  ensureAuditDir();
  const source = sourceRecovery();
  const inventory = existingInventory();
  const catalog = writeCatalogManifests(inventory);
  writeGoldSourceManifest(source);
  writeSourceReconciliationArtifacts(source);
  writeMissingSourceAcquisitionPlan(source);
  writeCorruptedSourceTriage(source);
  const triage = writeUnknownBlockerFinal(source);
  const gold = goldProgress(source);
  const reviewerArtifacts = writeReviewerArtifacts(source);
  const production = productionState();
  writeOperationalPlans(source, catalog, production, inventory);
  writeBenchmarkAndCertificate(source, gold, reviewerArtifacts);
  const preparationVerifier = resumeVerifier(source, gold, reviewerArtifacts, production, false);
  const laneSummary = buildLaneSummary(source, gold, production, catalog, preparationVerifier, reviewerArtifacts);
  const final = laneSummary.overall;
  writeJson(join(AUDIT_DIR, 'lane-status.json'), {
    schemaVersion: 'v61-lane-status-1',
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    ...laneSummary,
  });
  const verifier = resumeVerifier(source, gold, reviewerArtifacts, production);

  writeJson(join(AUDIT_DIR, 'gold-progress.json'), {
    schemaVersion: 'v61-gold-progress-controller-1',
    runId: RUN_ID,
    ...gold,
  });
  writeJson(join(AUDIT_DIR, 'reviewer-a-assignment.json'), {
    schemaVersion: 'v61-reviewer-assignment-controller-1',
    reviewer: 'A',
    status: gold.reviewerA.count >= 400 ? 'COMPLETE' : 'WAITING_HUMAN_REVIEW',
    assigned: 0,
    completed: gold.reviewerA.count,
    invalid: gold.reviewerA.invalid,
    humanEvidenceRequired: true,
  });
  writeJson(join(AUDIT_DIR, 'reviewer-b-assignment.json'), {
    schemaVersion: 'v61-reviewer-assignment-controller-1',
    reviewer: 'B',
    status: gold.reviewerB.count >= 400 ? 'COMPLETE' : 'WAITING_HUMAN_REVIEW',
    assigned: 0,
    completed: gold.reviewerB.count,
    invalid: gold.reviewerB.invalid,
    humanEvidenceRequired: true,
  });
  writeJson(join(AUDIT_DIR, 'dual-review-completion.json'), {
    schemaVersion: 'v61-dual-review-completion-controller-1',
    status: gold.reviewerA.count >= 400 && gold.reviewerB.count >= 400 ? 'COMPLETE' : 'WAITING_HUMAN_REVIEW',
    reviewerA: gold.reviewerA.count,
    reviewerB: gold.reviewerB.count,
    sameReviewerDetected: gold.sameReviewerDetected,
    certificateEligible: false,
  });
  writeJson(join(AUDIT_DIR, 'adjudication-queue.json'), {
    schemaVersion: 'v61-adjudication-queue-controller-1',
    status: gold.reviewerA.count >= 400 && gold.reviewerB.count >= 400 ? 'READY_TO_IMPORT' : 'WAITING_HUMAN_REVIEW',
    disagreementCount: null,
    criticalUnresolvedCount: null,
    adjudicationComplete: false,
  });
  writeJson(join(AUDIT_DIR, 'adjudication-report.json'), {
    schemaVersion: 'v61-adjudication-report-controller-1',
    status: 'NOT_RUN',
    reason: 'Reviewer A/B completion is not proven.',
  });
  writeJson(join(AUDIT_DIR, 'benchmark-report.json'), {
    schemaVersion: 'v61-benchmark-report-controller-1',
    status: 'NOT_RUN',
    reason: 'Gold 400 freeze, dual review, and adjudication are not complete.',
  });
  writeJson(join(AUDIT_DIR, 'rollback-proof.json'), {
    schemaVersion: 'v61-rollback-proof-controller-1',
    status: 'NOT_RUN',
    productionWrites: 0,
    reason: 'Production rollout approval and migrations are not complete.',
  });
  writeJson(join(AUDIT_DIR, 'auto-publish-readiness.json'), {
    schemaVersion: 'v61-auto-publish-readiness-controller-1',
    status: 'NOT_CERTIFIED',
    autoPublish: 'OFF_NOT_AUTHORIZED',
    goldStatus: gold.status,
    benchmarkStatus: 'NOT_RUN',
  });

  writeFinalGateReport(source, gold, production, catalog, triage, verifier, reviewerArtifacts, laneSummary);

  const nextAction = { state: final.state, description: final.description };
  const runState = {
    schemaVersion: 'v61-finalization-controller-run-state-2',
    run_id: RUN_ID,
    head_sha: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    clean: (git(['status', '--porcelain=v1', '--untracked-files=all']) || '') === '',
    phase: final.state,
    current_gate: final.state,
    last_completed_gate: 'INTERNAL_FINALIZATION_PREPARATION',
    next_action: nextAction,
    source_verified_count: source.counts.sourceHashVerified,
    gold_certified_count: gold.goldQualifiedSections,
    reviewer_a_count: gold.reviewerA.count,
    reviewer_b_count: gold.reviewerB.count,
    adjudicated_count: 0,
    catalog_total: catalog.total,
    published_validated_count: 0,
    safe_under_review_count: catalog.classC,
    production_write_count: 0,
    production_pointer_changes: 0,
    global_freeze_state: 'NOT_PROVEN_PRODUCTION_FREEZE_FALSE_OBSERVED',
    auto_publish_state: 'OFF_NOT_AUTHORIZED',
    blockers: [
      ...(source.counts.sourceMissing > 0 ? ['SOURCE_MISSING:' + source.counts.sourceMissing] : []),
      ...(source.counts.sourceCorrupt > 0 ? ['SOURCE_HASH_MISMATCH_OR_CORRUPT:' + source.counts.sourceCorrupt] : []),
      ...(gold.reviewerA.count < 400 || gold.reviewerB.count < 400 ? ['WAITING_HUMAN_REVIEW'] : []),
      ...(production.status !== 'APPROVAL_PRESENT_NOT_EXECUTED' ? ['PRODUCTION:' + production.status] : []),
    ],
    controller: {
      auditDirectory: AUDIT_RELATIVE.replaceAll('\\', '/'),
      sourceArtifact: source.fullArtifact,
      currentCandidateArtifact: source.currentArtifact,
      sourceSearchFiles: source.counts.searchedFiles,
      productionManifestHash: production.manifestHash,
      resumeVerifierPass: verifier.pass,
      internalPreparationComplete: verifier.pass,
      noProductionMutation: true,
    },
    overall: laneSummary.overall,
    lanes: laneSummary.lanes,
    updated_at: new Date().toISOString(),
  };
  const priorFinalState = readJson(join(AUDIT_DIR, 'final-state.json'), null);
  writeJson(join(AUDIT_DIR, 'final-state.json'), {
    schemaVersion: 'v61-controller-final-state-2',
    controllerRunId: RUN_ID,
    finalState: final.state,
    overall: laneSummary.overall,
    lanes: laneSummary.lanes,
    engine: 'PASS',
    manualProduction: production.status,
    existingCatalog: {
      total: catalog.total,
      classA: catalog.classA,
      classB: catalog.classB,
      classC: catalog.classC,
      publishedValidated: 0,
      safeUnderReviewPlanned: catalog.classC,
      actualWrites: 0,
    },
    gold: {
      status: gold.status,
      sourceHashVerifiedRows: gold.sourceHashVerifiedRows,
      sourceHashVerifiedSections: gold.sourceHashVerifiedSections,
      reviewerA: gold.reviewerA.count,
      reviewerB: gold.reviewerB.count,
      adjudicated: 0,
      certificate: 'NOT_ISSUED',
    },
    blockers: runState.blockers,
    next_action: nextAction,
    internalPreparationComplete: verifier.pass,
    externalInputsRequired: [
      `${source.counts.sourceMissing} original source files with exact hash verification`,
      `${source.counts.sourceCorrupt} hash-mismatch source cases requiring manual reconciliation`,
      'Reviewer A independent results for 400 Gold sections',
      'Reviewer B independent results for 400 Gold sections',
      'Adjudicator results for every A/B disagreement and critical price/date mismatch',
      `Owner approval for Lane A: ${CANARY_APPROVAL_SENTINEL}`,
      `Owner approval for Lane B: ${RECOVERY_APPROVAL_SENTINEL}`,
    ],
    approvalSentinel: CANARY_APPROVAL_SENTINEL,
    recoveryApprovalSentinel: RECOVERY_APPROVAL_SENTINEL,
    approvalReceived: production.approvalValid,
    noProductionMutation: true,
    priorFinalState: priorFinalState ? {
      schemaVersion: priorFinalState.schemaVersion,
      legacyStatus: priorFinalState.wholeProgram || priorFinalState.finalState || null,
    } : null,
  });
  writeJson(join(AUDIT_DIR, 'run-state.json'), runState);
  writeJson(join(AUDIT_DIR, 'resume-state.json'), {
    schemaVersion: 'v61-resume-state-controller-2',
    runId: RUN_ID,
    next_action: nextAction,
    overall: laneSummary.overall,
    lanes: laneSummary.lanes,
    resumeCommand: 'npm run v61:finalize -- --resume',
    sourceRecovery: source.counts,
    goldProgress: gold,
    production: production,
    resumeVerifier: verifier,
  });
  appendJsonLine(join(AUDIT_DIR, 'evidence.jsonl'), {
    recordType: 'v61_controller_run',
    runId: RUN_ID,
    date: new Date().toISOString(),
    state: final.state,
    overall: laneSummary.overall,
    lanes: laneSummary.lanes,
    sourceRecovery: source.counts,
    currentCandidate: source.currentCandidate,
    catalog,
    gold,
    production,
    verifier,
    finalGate: 'final-gate-report.md',
    noProductionMutation: true,
  });
  appendJsonLine(join(AUDIT_DIR, 'source-recovery-manifest.jsonl'), {
    recordType: 'controller_source_recovery_run',
    runId: RUN_ID,
    ...source.counts,
    currentCandidate: source.currentCandidate,
  });
  updateTextReport(source, catalog, gold, production, nextAction, laneSummary);

  const result = {
    runId: RUN_ID,
    state: final.state,
    overall: laneSummary.overall,
    lanes: laneSummary.lanes,
    nextAction,
    source: {
      ...source,
      rows: undefined,
    },
    catalog,
    gold,
    production,
    verifier,
    auditDirectory: AUDIT_RELATIVE.replaceAll('\\', '/'),
  };
  console.log(JSON.stringify(result, null, 2));
}

function status() {
  const state = readJson(join(AUDIT_DIR, 'run-state.json'), null);
  const finalState = readJson(join(AUDIT_DIR, 'final-state.json'), null);
  if (!state && !finalState) {
    console.log(JSON.stringify({
      state: 'NOT_STARTED',
      auditDirectory: AUDIT_RELATIVE.replaceAll('\\', '/'),
      resumeCommand: 'npm run v61:finalize -- --resume',
    }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    auditDirectory: AUDIT_RELATIVE.replaceAll('\\', '/'),
    runState: state,
    finalState,
  }, null, 2));
}

if (hasFlag('help')) {
  console.log('Usage: npm run v61:finalize [-- --resume|--status|--json]');
} else if (hasFlag('status')) {
  status();
} else {
  run();
}
