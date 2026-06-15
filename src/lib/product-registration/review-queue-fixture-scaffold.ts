import type { UploadReviewFixtureCandidate } from './review-queue-fixture-candidates';

export type UploadReviewFixtureScaffoldFile = {
  path: string;
  content: string;
};

export type UploadReviewFixtureScaffold = {
  fixtureId: string;
  baseDir: string;
  files: UploadReviewFixtureScaffoldFile[];
};

function safeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'upload-review-fixture';
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildUploadReviewFixtureScaffold(input: {
  candidate: UploadReviewFixtureCandidate;
  baseDir?: string;
}): UploadReviewFixtureScaffold {
  const candidate = input.candidate;
  const baseDir = input.baseDir ?? '.tmp/product-registration-fixture-scaffolds';
  const dir = `${baseDir}/${safeFileName(candidate.fixtureId)}`;
  const rawFixturePath = `${dir}/raw-fixture.txt`;
  const expectedPath = `${dir}/expected.json`;
  const workItemPath = `${dir}/work-item.md`;

  const rawFixture = [
    '# REVIEW REQUIRED: upload review fixture scaffold',
    `# queue_id: ${candidate.queueId}`,
    `# fixture_id: ${candidate.fixtureId}`,
    `# blocker_codes: ${candidate.codes.join(', ')}`,
    '# Replace this safe excerpt with the full reviewed supplier raw text before promotion.',
    '',
    candidate.sourceExcerpt ?? '',
    '',
  ].join('\n');

  const expected = {
    fixtureId: candidate.fixtureId,
    source: 'upload_review_queue',
    queueId: candidate.queueId,
    productTitle: candidate.productTitle,
    sourceFilename: candidate.sourceFilename,
    blockerCodes: candidate.codes,
    diagnostics: candidate.diagnostics,
    expectedAssertions: candidate.expectedAssertions,
    customerDeliverableAfterFix: true,
    promotionRequiredEdits: [
      'Replace raw-fixture.txt with full reviewed supplier raw text.',
      'Fill expected title, destination, duration, product_prices, price_dates, itinerary, flight, and render assertions.',
      'Add the reviewed fixture to GOLDEN_CORPUS_CASES or a focused regression test.',
    ],
    evidence: {
      rawTextHash: candidate.rawTextHash,
      fileHash: candidate.fileHash,
      normalizedContentHash: candidate.normalizedContentHash,
    },
  };

  const workItem = [
    `# ${candidate.fixtureId}`,
    '',
    `- Queue ID: ${candidate.queueId}`,
    `- Product: ${candidate.productTitle ?? candidate.sourceFilename ?? 'unknown'}`,
    `- Codes: ${candidate.codes.join(', ') || 'none'}`,
    `- Severity: ${candidate.severity}`,
    `- Next action: ${candidate.nextAction}`,
    '',
    '## Expected Assertions',
    ...candidate.expectedAssertions.map(assertion => `- ${assertion}`),
    '',
    '## Target Modules',
    ...candidate.targetModules.map(modulePath => `- ${modulePath}`),
    '',
    '## Verification',
    ...candidate.verificationCommands.map(command => `- \`${command}\``),
    '',
    '## Promotion Checklist',
    '- Replace the safe raw excerpt with the full reviewed supplier source.',
    '- Add exact expected output values before touching parser code.',
    '- Prove the failure reproduces before the fix.',
    '- Implement the deterministic parser/normalizer rule.',
    '- Run all verification commands and mobile/A4 proof for customer-visible changes.',
    '',
  ].join('\n');

  return {
    fixtureId: candidate.fixtureId,
    baseDir,
    files: [
      { path: rawFixturePath, content: rawFixture },
      { path: expectedPath, content: json(expected) },
      { path: workItemPath, content: workItem },
    ],
  };
}

export function buildUploadReviewFixtureScaffolds(input: {
  candidates: UploadReviewFixtureCandidate[];
  baseDir?: string;
  limit?: number;
}): UploadReviewFixtureScaffold[] {
  return input.candidates
    .slice(0, input.limit ?? input.candidates.length)
    .map(candidate => buildUploadReviewFixtureScaffold({
      candidate,
      baseDir: input.baseDir,
    }));
}
