import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

function readUploadRoute(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/upload/route.ts'), 'utf8');
}

function readPackageReextractRoute(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/packages/reextract/route.ts'), 'utf8');
}

function readAdminUploadPage(): string {
  return readFileSync(join(process.cwd(), 'src/app/admin/upload/page.tsx'), 'utf8');
}

function readUploadRegistrationPipeline(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-registration-pipeline.ts'), 'utf8');
}

function readMobileReadinessAudit(): string {
  return readFileSync(join(process.cwd(), 'scripts/audit-product-mobile-landing-readiness.mjs'), 'utf8');
}

function readPersistenceRows(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/persistence-rows.ts'), 'utf8');
}

function readPersistenceExecutor(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-persistence.ts'), 'utf8');
}

function readSupplierContext(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-supplier-context.ts'), 'utf8');
}

function readSourceResolution(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-source-resolution.ts'), 'utf8');
}

function readRawNormalizer(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-raw-normalizer.ts'), 'utf8');
}

function readRegistrationNormalization(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-registration-normalization.ts'), 'utf8');
}

function readDocumentHashes(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-document-hashes.ts'), 'utf8');
}

function readDocumentParsing(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-document-parsing.ts'), 'utf8');
}

function readPostRegistrationTasks(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-post-registration-tasks.ts'), 'utf8');
}

function readUploadReviewQueue(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-review-queue.ts'), 'utf8');
}

function readUploadContextLoader(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-context-loader.ts'), 'utf8');
}

function readUploadRequestIntake(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-request-intake.ts'), 'utf8');
}

function readUploadArchive(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-archive.ts'), 'utf8');
}

function readUploadProductRunner(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-product-runner.ts'), 'utf8');
}

function readUploadRegistrationCompletion(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-registration-completion.ts'), 'utf8');
}

function readUnmatchedQueue(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/unmatched-queue.ts'), 'utf8');
}

function readUploadResponse(): string {
  return readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-response.ts'), 'utf8');
}

describe('upload route registration pipeline boundary', () => {
  it('keeps the production upload request within a long-running Node function envelope', () => {
    const route = readUploadRoute();

    expect(route).toContain("export const runtime = 'nodejs'");
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    expect(route).toContain('export const maxDuration = 300');
    expect(route).toContain('x-upload-request-id');
    expect(route).toContain('uploadRequestId');
    expect(route).toContain('[Upload API] request complete:');
  });

  it('serializes admin text registration requests to avoid overloading the upload engine', () => {
    const page = readAdminUploadPage();

    expect(page).toContain('const MAX_CONCURRENT = 1;');
    expect(page).toContain('uploadExceptionMessage(err)');
  });

  it('keeps request intake, source metadata, and input quality checks outside the route body', () => {
    const route = readUploadRoute();
    const intake = readUploadRequestIntake();

    expect(route).toContain("from '@/lib/product-registration/upload-request-intake'");
    expect(route).toContain('const intake = await prepareUploadRequestIntake(request)');
    expect(route).toContain("from '@/lib/product-registration/upload-registration-pipeline'");
    expect(route).toContain('const result = await runUploadRegistrationPipeline({');
    expect(route).not.toContain("from '@/lib/upload-source-metadata'");
    expect(route).not.toContain("from '@/lib/product-registration-input-guard'");
    expect(route).not.toContain('parseUploadSourceMetadata({');
    expect(route).not.toContain('analyzeUploadInputText(');
    expect(route).not.toContain('const contentType = request.headers.get');
    expect(route).not.toContain('await request.formData()');
    expect(route).not.toContain('await request.json()');
    expect(route).not.toContain('createHash(');
    expect(route).not.toContain('ALLOWED_UPLOAD_EXTENSIONS');
    expect(intake).toContain('parseUploadSourceMetadata({');
    expect(intake).toContain('analyzeUploadInputText(directRawText)');
    expect(intake).toContain('const contentType = request.headers.get');
    expect(intake).toContain('await request.formData()');
    expect(intake).toContain('await request.json()');
    expect(intake).toContain('createHash(');
  });

  it('keeps the per-product registration loop outside the route', () => {
    const route = readUploadRoute();
    const pipeline = readUploadRegistrationPipeline();
    const runner = readUploadProductRunner();

    expect(route).toContain('runUploadRegistrationPipeline({');
    expect(route).not.toContain('await processUploadRegistrationProducts({');
    expect(pipeline).toContain('await processUploadRegistrationProducts({');
    expect(route).not.toMatch(/for\s*\(\s*let\s+productIndex\s*=\s*0;\s*productIndex\s*</);
    expect(runner).toMatch(/for\s*\(\s*let\s+productIndex\s*=\s*0;\s*productIndex\s*<\s*input\.productsToSave\.length/);
    expect(runner).toContain('const registrationResult: StandardProductRegistrationObject = await registerProductFromRaw({');
    expect(runner).toContain('const persistenceResult = await persistUploadRegistrationRows({');
  });

  it('makes the standard registration object the runner persistence contract', () => {
    const runner = readUploadProductRunner();
    const types = readFileSync(join(process.cwd(), 'src/lib/product-registration/types.ts'), 'utf8');

    expect(types).toContain('export type StandardProductRegistrationObject = ProductRegistrationResult');
    expect(runner).toContain("import type { StandardProductRegistrationObject } from '@/lib/product-registration/types'");
    expect(runner).toContain('const registrationResult: StandardProductRegistrationObject = await registerProductFromRaw({');
  });

  it('keeps price recovery centralized outside the route', () => {
    const route = readUploadRoute();
    const pipeline = readUploadRegistrationPipeline();
    const runner = readUploadProductRunner();

    expect(route).not.toContain("from '@/lib/product-registration/upload-product-runner'");
    expect(route).not.toContain('await processUploadRegistrationProducts({');
    expect(pipeline).toContain("from './upload-product-runner'");
    expect(pipeline).toContain('await processUploadRegistrationProducts({');
    expect(route).not.toContain("from '@/lib/product-registration/register-product-from-raw'");
    expect(route).not.toMatch(/\bregisterProductFromRaw\(/);
    expect(runner.match(/\bregisterProductFromRaw\(/g) ?? []).toHaveLength(1);
    expect(runner).toContain("from '@/lib/product-registration/register-product-from-raw'");
    expect(route).not.toMatch(/\brecoverUploadPriceData\(/);
    expect(route).not.toMatch(/\bevaluateUploadDeliverability\(/);
    expect(route).not.toMatch(/\bnormalizeUploadItinerary\(/);

    expect(route).not.toMatch(/\bpriceTiersToRows\b/);
    expect(route).not.toMatch(/\btiersToDatePrices\b/);
    expect(route).not.toMatch(/\bhydratePriceTiers\b/);
    expect(route).not.toMatch(/\bextractPriceTable\b/);
    expect(route).not.toMatch(/\bextractPriceMatrix\b/);
    expect(route).not.toMatch(/\bminPriceFromTiers\b/);
    expect(route).not.toMatch(/from ['"]@\/lib\/price-dates['"]/);
    expect(runner).not.toMatch(/\brecoverUploadPriceData\(/);
  });

  it('keeps deterministic product field recovery inside the registration object', () => {
    const route = readUploadRoute();

    expect(route).not.toMatch(/\bdetectFerry\b/);
    expect(route).not.toMatch(/\bextractBullets\b/);
    expect(route).not.toMatch(/\bpostProcessCatalogFields\b/);
    expect(route).not.toMatch(/\blooksLikeCommaSplitBroken\b/);
    expect(route).not.toMatch(/\bsanitizeForCustomer\b/);
    expect(route).not.toMatch(/\bdetectCriticIssues\b/);
    expect(route).not.toMatch(/\bautoFixCriticIssues\b/);
    expect(route).not.toMatch(/\bgenerateRecommendationCopy\b/);
    expect(route).not.toMatch(/\bisWeakCopy\b/);
  });

  it('keeps supplier raw facts and product-field recovery inside the registration object', () => {
    const route = readUploadRoute();

    expect(route).not.toMatch(/\bextractSupplierRawDeterministicFacts\(/);
    expect(route).not.toMatch(/\bbuildSupplierRawDeterministicItinerary\(/);
    expect(route).not.toMatch(/\binferDepartureDaysFromRawText\(/);
    expect(route).not.toMatch(/\binferAccommodationsFromRawText\(/);
    expect(route).not.toMatch(/\bnormalizeUploadTitle\(/);
  });

  it('keeps extraction validation and destination code resolution inside the registration pipeline', () => {
    const route = readUploadRoute();
    const runner = readUploadProductRunner();
    const registrationIndex = runner.indexOf('const registrationResult: StandardProductRegistrationObject = await registerProductFromRaw(');
    const gateIndex = runner.indexOf('const deliverability = registrationResult.deliverability', registrationIndex);
    const destinationIndex = runner.indexOf('const destinationResolution = registrationResult.destination', gateIndex);
    const codeIssueIndex = runner.indexOf('issueUploadInternalCode({', destinationIndex);

    expect(route).not.toMatch(/\bvalidateExtractedProduct\(/);
    expect(route).not.toMatch(/\brepairExtractedDataWithGemini\(/);
    expect(route).not.toMatch(/\bapplyDeterministicExtractedDataFixes\(/);
    expect(route).not.toMatch(/\bresolveUploadDestinationAndCodes\(/);
    expect(route).not.toMatch(/\bresolveCode\(/);
    expect(registrationIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(registrationIndex);
    expect(destinationIndex).toBeGreaterThan(gateIndex);
    expect(codeIssueIndex).toBeGreaterThan(destinationIndex);
  });

  it('keeps section-aware learning side effects outside the route body', () => {
    const route = readUploadRoute();
    const runner = readUploadProductRunner();

    expect(route).not.toContain('recordUploadSectionSignals({ rawText: rawForDeterm, extractedData: ed })');
    expect(runner).toContain('recordUploadSectionSignals({ rawText: rawForDeterm, extractedData: ed })');
    expect(route).not.toContain('runMicroAutoQA({');
    expect(runner).toContain('runMicroAutoQA({');
    expect(route).not.toContain('persistImprovementLedgerEvents({');
    expect(runner).toContain('persistImprovementLedgerEvents({');
    expect(route).not.toMatch(/\bparseSections\(/);
    expect(route).not.toMatch(/\bclassifyByContext\(/);
    expect(route).not.toMatch(/\blookupSignal\(/);
    expect(route).not.toMatch(/\brecordSignal\(/);
  });

  it('keeps supplier and departure context resolution outside the route body', () => {
    const route = readUploadRoute();
    const pipeline = readUploadRegistrationPipeline();
    const supplierContext = readSupplierContext();
    const sourceResolution = readSourceResolution();

    expect(route).not.toContain("from '@/lib/product-registration/upload-source-resolution'");
    expect(route).not.toContain('const uploadSource = resolveUploadSourceForRegistration({');
    expect(pipeline).toContain("from './upload-source-resolution'");
    expect(pipeline).toContain('const uploadSource = resolveUploadSourceForRegistration({');
    expect(route).not.toContain("from '@/lib/product-registration/upload-supplier-context'");
    expect(route).not.toContain("from '@/lib/product-registration/destination-resolution'");
    expect(route).not.toMatch(/const SUPPLIER_MAP\b/);
    expect(route).not.toMatch(/function parseFilename\(/);
    expect(route).not.toMatch(/\bparseFilename\(/);
    expect(route).not.toMatch(/function resolveSupplierCode\(/);
    expect(route).not.toMatch(/\bresolveSupplierCode\(/);
    expect(route).not.toMatch(/function resolveLandOperatorId\(/);
    expect(route).not.toMatch(/\bresolveLandOperatorId\(/);
    expect(route).not.toMatch(/function identifySupplierFromText\(/);
    expect(route).not.toMatch(/function resolveDepartingLocationId\(/);
    expect(route).not.toMatch(/\bresolveDepartingLocationId\(/);
    expect(route).not.toMatch(/\bextractUploadDestinationFromFilename\(/);
    expect(route).not.toContain("from '@/lib/secret-registry'");
    expect(sourceResolution).toContain('parseFilename(input.fileName)');
    expect(sourceResolution).toContain('resolveSupplierCode(filenameRule.supplierRaw)');
    expect(sourceResolution).toContain('extractUploadDestinationFromFilename(input.fileName)');
    expect(sourceResolution).toContain('resolveLandOperatorId(filenameRule.supplierRaw');
    expect(supplierContext).toContain('export function parseFilename');
    expect(supplierContext).toContain('export async function identifySupplierFromText');
    expect(supplierContext).toContain('export function resolveDepartingLocationId');
  });

  it('keeps upload master-data loading outside the route body', () => {
    const route = readUploadRoute();
    const pipeline = readUploadRegistrationPipeline();
    const contextLoader = readUploadContextLoader();

    expect(route).not.toContain("from '@/lib/product-registration/upload-context-loader'");
    expect(route).not.toContain('const uploadContext = await loadUploadRegistrationContext({');
    expect(route).not.toContain('const activeAttractions = uploadContext.activeAttractions');
    expect(pipeline).toContain("from './upload-context-loader'");
    expect(pipeline).toContain('const uploadContext = await loadUploadRegistrationContext({');
    expect(pipeline).toContain('const activeAttractions = uploadContext.activeAttractions');
    expect(route).not.toContain('function loadActiveAttractionsForUpload');
    expect(route).not.toContain('UPLOAD_ATTRACTION_SELECT');
    expect(route).not.toContain("supabaseAdmin.from('land_operators')");
    expect(route).not.toContain("supabaseAdmin.from('departing_locations')");
    expect(route).not.toContain(".from('attractions')");
    expect(route).not.toContain('ATTRACTION_EXTRACT_FALLBACK');
    expect(contextLoader).toContain("input.supabase.from('land_operators')");
    expect(contextLoader).toContain("input.supabase.from('departing_locations')");
    expect(contextLoader).toContain(".from('attractions')");
    expect(contextLoader).toContain('export async function loadUploadRegistrationContext');
  });

  it('loads only customer-publishable attractions for upload enrichment', () => {
    const contextLoader = readUploadContextLoader();

    expect(contextLoader).toContain('customer_publishable');
    expect(contextLoader).toContain(".eq('customer_publishable', true)");
  });

  it('keeps archive-mode product persistence outside the route body', () => {
    const route = readUploadRoute();
    const pipeline = readUploadRegistrationPipeline();
    const archive = readUploadArchive();

    expect(route).not.toContain("from '@/lib/product-registration/upload-archive'");
    expect(route).not.toContain('const archiveResult = await archiveUploadRawProduct({');
    expect(pipeline).toContain("from './upload-archive'");
    expect(pipeline).toContain('const archiveResult = await archiveUploadRawProduct({');
    expect(route).not.toContain("supabaseAdmin.from('products')");
    expect(route).not.toContain(".from('products').upsert");
    expect(route).not.toContain('raw_extracted_text: rawText');
    expect(route).not.toContain('ARCH-${filenameRule.cleanName');
    expect(archive).toContain(".from('products').upsert");
    expect(archive).toContain('raw_extracted_text: rawText');
    expect(archive).toContain('export async function archiveUploadRawProduct');
  });

  it('keeps attraction review queue error handling outside the route body', () => {
    const route = readUploadRoute();
    const completion = readUploadRegistrationCompletion();
    const unmatchedQueue = readUnmatchedQueue();

    expect(route).not.toContain("from '@/lib/product-registration/unmatched-queue'");
    expect(route).not.toContain('await flushUploadAttractionReviewQueue({');
    expect(completion).toContain("from './unmatched-queue'");
    expect(completion).toContain('await flushUploadAttractionReviewQueue({');
    expect(route).not.toContain('queueUploadAttractionReviewCandidates({');
    expect(route).not.toContain('attraction review queue failed');
    expect(unmatchedQueue).toContain('export async function flushUploadAttractionReviewQueue');
    expect(unmatchedQueue).toContain('queueUploadAttractionReviewCandidates(input)');
    expect(unmatchedQueue).toContain('attraction review queue failed');
  });

  it('keeps raw upload normalizer routing outside the route body', () => {
    const route = readUploadRoute();
    const pipeline = readUploadRegistrationPipeline();
    const registrationNormalization = readRegistrationNormalization();
    const rawNormalizer = readRawNormalizer();

    expect(route).not.toContain("from '@/lib/product-registration/upload-raw-normalizer'");
    expect(route).not.toContain("from '@/lib/product-registration/upload-registration-normalization'");
    expect(route).not.toContain('const normalizedRegistrationDocument = await normalizeUploadRegistrationDocument({');
    expect(pipeline).toContain("from './upload-registration-normalization'");
    expect(pipeline).toContain('const normalizedRegistrationDocument = await normalizeUploadRegistrationDocument({');
    expect(route).not.toContain('const rawNormalizer = await applyUploadRawNormalizer({');
    expect(registrationNormalization).toContain("from './upload-raw-normalizer'");
    expect(registrationNormalization).toContain('const rawNormalizer = await applyUploadRawNormalizer({');
    expect(route).not.toContain("from '@/lib/upload-ir-extract'");
    expect(route).not.toContain('tryExtractUploadViaIr(');
    expect(route).not.toContain('shouldSampleToIrCanary(');
    expect(route).not.toContain('canUseSupplierRawDeterministicPreflight(');
    expect(rawNormalizer).toContain('tryExtractUploadViaIr({');
    expect(rawNormalizer).toContain('shouldSampleToIrCanary(input.normalizedCatalogHash)');
    expect(rawNormalizer).toContain('canUseSupplierRawDeterministicPreflight(input.parsedDocument.rawText');
  });

  it('keeps document parsing, parse context, and parsed-text duplicate checks outside the route body', () => {
    const route = readUploadRoute();
    const pipeline = readUploadRegistrationPipeline();
    const documentParsing = readDocumentParsing();

    expect(route).not.toContain("from '@/lib/product-registration/upload-document-parsing'");
    expect(route).not.toContain('const parsedForRegistration = await parseUploadDocumentForRegistration({');
    expect(pipeline).toContain("from './upload-document-parsing'");
    expect(pipeline).toContain('const parsedForRegistration = await parseUploadDocumentForRegistration({');
    expect(route).not.toContain("from '@/lib/reflection-memory'");
    expect(route).not.toContain("from '@/lib/region-cache-context'");
    expect(route).not.toContain("from '@/lib/land-operator-profile'");
    expect(route).not.toContain("from '@/lib/parser/upload-text-hash'");
    expect(route).not.toContain("from '@/lib/parser/catalog-pre-split'");
    expect(route).not.toContain('parseDocument(buffer');
    expect(route).not.toContain('parseStandardProductMarkdown(');
    expect(route).not.toContain('applyUploadV2Preflight(parsedDocument)');
    expect(documentParsing).toContain('parseDocument(input.buffer');
    expect(documentParsing).toContain('parseStandardProductMarkdown(');
    expect(documentParsing).toContain('applyUploadV2Preflight(parsedDocument)');
    expect(documentParsing).toContain('checkParsedDocumentNormalizedDuplicate({');
  });

  it('keeps upload duplicate document-hash decisions outside the route body', () => {
    const route = readUploadRoute();
    const pipeline = readUploadRegistrationPipeline();
    const completion = readUploadRegistrationCompletion();
    const documentParsing = readDocumentParsing();
    const documentHashes = readDocumentHashes();

    expect(route).not.toContain("from '@/lib/product-registration/upload-document-hashes'");
    expect(route).not.toContain('const initialDuplicate = await checkInitialUploadDuplicate({');
    expect(pipeline).toContain("from './upload-document-hashes'");
    expect(pipeline).toContain('const initialDuplicate = await checkInitialUploadDuplicate({');
    expect(route).not.toContain('const parsedDuplicate = await checkParsedDocumentNormalizedDuplicate({');
    expect(documentParsing).toContain('const duplicate = await checkParsedDocumentNormalizedDuplicate({');
    expect(route).not.toContain('const hashRecord = await recordUploadDocumentHash({');
    expect(completion).toContain('const hashRecord = await recordUploadDocumentHash({');
    expect(route).not.toContain(".from('document_hashes')");
    expect(route).not.toMatch(/\\.eq\\('file_hash', fileHash\\)/);
    expect(route).not.toMatch(/\\.eq\\('normalized_hash', normalizedCatalogHash\\)/);
    expect(documentHashes).toContain(".from('document_hashes')");
    expect(documentHashes).toContain('export async function checkInitialUploadDuplicate');
    expect(documentHashes).toContain('export async function recordUploadDocumentHash');
  });

  it('keeps post-registration sidecar and audit tasks outside the route body', () => {
    const route = readUploadRoute();
    const completion = readUploadRegistrationCompletion();
    const postTasks = readPostRegistrationTasks();
    const runner = readUploadProductRunner();

    expect(route).not.toContain("from '@/lib/product-registration/upload-post-registration-tasks'");
    expect(completion).toContain("from './upload-post-registration-tasks'");
    expect(route).not.toContain('void recordUploadAiQualityLog({');
    expect(route).not.toContain('scheduleUploadPostRegistrationTasks({');
    expect(route).not.toContain('scheduleUploadL3BackfillTasks({');
    expect(completion).toContain('scheduleUploadL3BackfillTasks({');
    expect(route).not.toContain('await logUploadPostSaveAuditStatus({');
    expect(runner).toContain('void recordUploadAiQualityLog({');
    expect(runner).toContain('scheduleUploadPostRegistrationTasks({');
    expect(runner).toContain('await logUploadPostSaveAuditStatus({');
    expect(route).not.toContain("from '@/lib/product-registration-v3'");
    expect(route).not.toContain("from '@/lib/cove-audit-bridge'");
    expect(route).not.toContain("from '@/lib/upload-verify'");
    expect(route).not.toContain("from '@/lib/auto-mobile-qa'");
    expect(route).not.toContain("from '@/lib/auto-photo-match'");
    expect(route).not.toContain("from '@/lib/upload-ir-shadow'");
    expect(route).not.toContain("import('@/lib/itinerary-llm-extractor')");
    expect(route).not.toContain("import('@/lib/parser/llm/section-extractors')");
    expect(route).not.toContain('backfillPackageAttractionsL3(');
    expect(route).not.toContain('backfillSectionsByPackageId(');
    expect(route).not.toContain('runProductRegistrationV3(');
    expect(route).not.toContain('persistProductRegistrationDraftV3(');
    expect(route).not.toContain('runCoVeInBackground(');
    expect(route).not.toContain('runUploadVerify(');
    expect(route).not.toContain('runAutoMobileQA(');
    expect(route).not.toContain('runUploadIrShadowIfSampled(');
    expect(route).not.toContain('runAutoPhotoMatch(');
    expect(route).not.toContain(".from('travel_packages')");
    expect(postTasks).toContain('runProductRegistrationV3(input.rawText');
    expect(postTasks).toContain('runCoVeInBackground(input.packageId)');
    expect(postTasks).toContain('runAutoPhotoMatch({');
    expect(postTasks).toContain('export async function logUploadPostSaveAuditStatus');
    expect(postTasks).toContain(".from('travel_packages')");
    expect(postTasks).toContain('export function scheduleUploadL3BackfillTasks');
    expect(postTasks).toContain('backfillPackageAttractionsL3(packageId');
    expect(postTasks).toContain('backfillSectionsByPackageId(packageId');
  });

  it('keeps upload review queue persistence outside the route body', () => {
    const route = readUploadRoute();
    const reviewQueue = readUploadReviewQueue();
    const runner = readUploadProductRunner();

    expect(route).not.toContain("from '@/lib/product-registration/upload-review-queue'");
    expect(runner).toContain("from '@/lib/product-registration/upload-review-queue'");
    expect(route).not.toContain('scheduleUploadReviewInsert({');
    expect(runner).toContain('scheduleUploadReviewInsert({');
    expect(route).not.toContain("from('upload_review_queue')");
    expect(route).not.toContain(".from('upload_review_queue')");
    expect(route).not.toContain('function scheduleUploadReviewInsert');
    expect(route).not.toContain('raw_text_chunk:');
    expect(route).not.toContain('error_reason:');
    expect(reviewQueue).toContain(".from('upload_review_queue')");
    expect(reviewQueue).toContain('safeRawTextExcerpt(input.rawText');
    expect(reviewQueue).toContain('export function scheduleUploadReviewInsert');
  });

  it('keeps upload response report and trust-score composition outside the route body', () => {
    const route = readUploadRoute();
    const pipeline = readUploadRegistrationPipeline();
    const completion = readUploadRegistrationCompletion();
    const uploadResponse = readUploadResponse();

    expect(route).not.toContain("from '@/lib/product-registration/upload-response'");
    expect(route).not.toContain("from '@/lib/product-registration/upload-registration-completion'");
    expect(route).not.toContain('const responsePayload = await completeUploadRegistration({');
    expect(pipeline).toContain("from './upload-registration-completion'");
    expect(pipeline).toContain('const responsePayload = await completeUploadRegistration({');
    expect(completion).toContain("from './upload-response'");
    expect(completion).toContain('return buildUploadResponsePayload({');
    expect(route).not.toContain("from '@/lib/product-registration-register-report'");
    expect(route).not.toContain("from '@/lib/product-registration-trust-score'");
    expect(route).not.toContain('buildUploadRegisterReport(');
    expect(route).not.toContain('calculateProductRegistrationTrustScore(');
    expect(route).not.toContain('const tokenInfo =');
    expect(route).not.toContain('const overallGate');
    expect(uploadResponse).toContain('buildUploadRegisterReport');
    expect(uploadResponse).toContain('calculateProductRegistrationTrustScore');
    expect(uploadResponse).toContain('export async function buildUploadResponsePayload');
  });

  it('does not run optional marketing generation in the upload save path', () => {
    const route = readUploadRoute();
    const runner = readUploadProductRunner();

    expect(route).not.toContain("from '@/lib/ai'");
    expect(route).not.toContain('generateMarketingCopies(');
    expect(route).not.toContain('if (false) try');
    expect(runner).toContain('marketingCopies: []');
  });

  it('runs the customer deliverability gate before saving generated prices', () => {
    const runner = readUploadProductRunner();
    const gateIndex = runner.indexOf('const deliverability = registrationResult.deliverability');
    const persistenceBuildIndex = runner.indexOf('const persistenceRows = buildUploadPersistenceRows({');
    const persistCallIndex = runner.indexOf('const persistenceResult = await persistUploadRegistrationRows({');

    expect(gateIndex).toBeGreaterThan(-1);
    expect(persistenceBuildIndex).toBeGreaterThan(gateIndex);
    expect(persistCallIndex).toBeGreaterThan(persistenceBuildIndex);
  });

  it('does not persist finalized registrations blocked by the upload gate', () => {
    const runner = readUploadProductRunner();
    const uploadGateIndex = runner.indexOf("if (uploadGate === 'BLOCKED') {");
    const blockedContinueIndex = runner.indexOf('finalized upload gate blocked insert', uploadGateIndex);
    const persistenceBuildIndex = runner.indexOf('const persistenceRows = buildUploadPersistenceRows({');
    const persistCallIndex = runner.indexOf('const persistenceResult = await persistUploadRegistrationRows({');
    const blockedGateBody = runner.slice(uploadGateIndex, persistenceBuildIndex);

    expect(uploadGateIndex).toBeGreaterThan(-1);
    expect(blockedContinueIndex).toBeGreaterThan(uploadGateIndex);
    expect(blockedGateBody).toContain('continue;');
    expect(persistenceBuildIndex).toBeGreaterThan(blockedContinueIndex);
    expect(persistCallIndex).toBeGreaterThan(persistenceBuildIndex);
  });

  it('upserts the products ledger with the recovered representative price', () => {
    const route = readUploadRoute();
    const runner = readUploadProductRunner();
    const rows = readPersistenceRows();
    const persistence = readPersistenceExecutor();
    const recoveryIndex = runner.indexOf('const registrationResult: StandardProductRegistrationObject = await registerProductFromRaw(');
    const netPriceIndex = runner.indexOf('let netPrice = priceRecovery.minPrice ?? ed.price ?? 0');
    const persistenceBuildIndex = runner.indexOf('const persistenceRows = buildUploadPersistenceRows({');
    const persistCallIndex = runner.indexOf('const persistenceResult = await persistUploadRegistrationRows({');

    expect(recoveryIndex).toBeGreaterThan(-1);
    expect(netPriceIndex).toBeGreaterThan(recoveryIndex);
    expect(persistenceBuildIndex).toBeGreaterThan(netPriceIndex);
    expect(persistCallIndex).toBeGreaterThan(persistenceBuildIndex);
    expect(rows).toContain('net_price: input.netPrice');
    expect(rows).toContain('price_dates: input.priceDates');
    expect(persistence).toContain(".from('products')");
    expect(persistence).toContain(".upsert(input.rows.productRow, { onConflict: 'internal_code' })");
    expect(persistence).toContain('replaceProductPricesForProduct({');
    expect(persistence).toContain(".from('travel_packages')");
    expect(route).not.toContain('selling_price:');
  });

  it('treats product_prices persistence as mandatory for customer deliverables', () => {
    const rows = readPersistenceRows();
    const persistence = readPersistenceExecutor();

    expect(rows).toContain('adult_selling_price: row.adult_selling_price ?? row.net_price');
    expect(persistence).toContain('replaceProductPricesForProduct({');
    expect(persistence).toContain('throw new Error(priceErrorMessage)');
    expect(persistence).toContain(".from('products')");
    expect(persistence).toContain(".delete()");
    expect(persistence).not.toContain('keeping product for review');
  });

  it('does not treat an updated existing product as a rollback-created product', () => {
    const runner = readUploadProductRunner();
    const persistence = readPersistenceExecutor();
    const existingLookupIndex = persistence.indexOf('const { data: existingProductBeforeWriteRow }');
    const productInsertedIndex = persistence.indexOf('result.productInserted = !existingProductBeforeWrite');
    const rollbackCallIndex = runner.indexOf('const rollback = await rollbackInsertedUploadProduct({');

    expect(existingLookupIndex).toBeGreaterThan(-1);
    expect(productInsertedIndex).toBeGreaterThan(existingLookupIndex);
    expect(rollbackCallIndex).toBeGreaterThan(runner.indexOf('productInserted = persistenceResult.productInserted'));
  });

  it('fails strict mobile/A4 audit when products ledger price drifts from the package price', () => {
    const audit = readMobileReadinessAudit();

    expect(audit).toContain('function productLedgerPriceMismatch(pkg, productRow)');
    expect(audit).toContain('function customerPriceOptionMismatch(pkg, productPriceRows)');
    expect(audit).toContain('products.net_price');
    expect(audit).toContain('travel_packages.price');
    expect(audit).toContain("failures.push('product_ledger_price_mismatch')");
    expect(audit).toContain("failures.push('customer_price_option_mismatch')");
    expect(audit).toContain("strictFailures.push('product_ledger_price_mismatch')");
    expect(audit).toContain("strictFailures.push('customer_price_option_mismatch')");
  });

  it('fails strict mobile/A4 audit when customer-visible products are not V3 publishable', () => {
    const audit = readMobileReadinessAudit();

    expect(audit).toContain("warnings.push('v3_needs_review')");
    expect(audit).toContain('missing_v3_draft');
    expect(audit).toContain("strictFailures.push('v3_blocked')");
    expect(audit).toContain("strictFailures.push('v3_needs_review')");
    expect(audit).toContain("strictFailures.push('missing_v3_draft')");
  });

  it('uses the latest V3 draft match summary before stale unmatched queue rows in mobile/A4 audit', () => {
    const audit = readMobileReadinessAudit();

    expect(audit).toContain('function draftAttractionUnmatchedCount(draft)');
    expect(audit).toContain('match_summary, created_at');
    expect(audit).toContain("eq('status', 'pending')");
    expect(audit).toContain("is('resolved_attraction_id', null)");
    expect(audit).toContain('draftAttractionUnmatchedCount(draft) ?? unmatchedCountMap.get(pkg.id) ?? 0');
  });

  it('normalizes itinerary before the deliverability gate evaluates A4/mobile inputs', () => {
    const runner = readUploadProductRunner();
    const normalizeIndex = runner.indexOf('const itineraryNormalization = registrationResult.itinerary');
    const gateIndex = runner.indexOf('const deliverability = registrationResult.deliverability');
    const normalizedDaysIndex = runner.indexOf('const itineraryInput = itineraryNormalization.itineraryInput');

    expect(normalizeIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(normalizeIndex);
    expect(normalizedDaysIndex).toBeGreaterThan(normalizeIndex);
  });

  it('classifies upload gate from the finalized registration result', () => {
    const route = readUploadRoute();
    const runner = readUploadProductRunner();
    const assignIndex = runner.indexOf('Object.assign(ed, registrationResult.extractedData)');
    const finalizeIndex = runner.indexOf('const finalizedRegistration = finalizeUploadRegistration({');
    const uploadGateIndex = runner.indexOf('const uploadGate: UploadGate = finalizedRegistration.uploadGate');
    const confidenceIndex = runner.indexOf('const confidenceV3 = finalizedRegistration.confidenceV3');

    expect(assignIndex).toBeGreaterThan(-1);
    expect(finalizeIndex).toBeGreaterThan(assignIndex);
    expect(uploadGateIndex).toBeGreaterThan(finalizeIndex);
    expect(confidenceIndex).toBeGreaterThan(finalizeIndex);
    expect(route).not.toContain('classifyUploadGate(validation, confidenceV3, priceRows.length)');
    expect(route).not.toContain('classifyUploadGate(validation, confidence, priceRows.length)');
    expect(route).not.toContain('prepareRegistrationWrite({');
    expect(route).not.toContain('evaluateCustomerReadyGate({');
    expect(route).not.toContain('mapTravelPackageUploadStatus(');
    expect(route).not.toContain('const v3FailedChecks = finalizedRegistration.failedChecks');
    expect(runner).toContain('const v3FailedChecks = finalizedRegistration.failedChecks');
    expect(route).not.toContain("v2WithAttraction.checks.filter(c => !c.passed)");
    expect(route).not.toContain('normalizerFailureCoveredByDeterministicFallback');
  });

  it('does not let document-level V3 gate override the standardized registration result status', () => {
    const route = readUploadRoute();
    const pipeline = readUploadRegistrationPipeline();
    const preparation = readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-registration-preparation.ts'), 'utf8');
    const preflight = readFileSync(join(process.cwd(), 'src/lib/product-registration/upload-preflight.ts'), 'utf8');

    expect(route).not.toContain('const preparedRegistrationProducts = await prepareUploadRegistrationProducts({');
    expect(pipeline).toContain('const preparedRegistrationProducts = await prepareUploadRegistrationProducts({');
    expect(route).not.toContain('const v3CatalogPreflight = await runUploadV3CatalogPreflight({');
    expect(preparation).toContain('const v3CatalogPreflight = await runUploadV3CatalogPreflight({');
    expect(preflight).toContain('const preSaveV3Result = await runProductRegistrationV3');
    expect(route).not.toMatch(/if\s*\(\s*!preSaveV3Result\.gate_result\.customer_publishable\s*\)\s*{[\s\S]*?productStatus\s*=\s*'REVIEW_NEEDED'/);
  });

  it('routes saved package re-extraction through the central registration engine', () => {
    const reextract = readPackageReextractRoute();

    expect(reextract).toContain("from '@/lib/product-registration/register-product-from-raw'");
    expect(reextract).toContain("from '@/lib/product-registration/finalize-registration'");
    expect(reextract).toContain("from '@/lib/product-registration/auto-qa'");
    expect(reextract).toContain("from '@/lib/product-registration/improvement-ledger-persistence'");
    expect(reextract).toContain("from '@/lib/product-registration/product-price-replacement'");
    expect(reextract).toContain('let registration = await registerProductFromRaw({');
    expect(reextract).toContain('let finalized = finalizeUploadRegistration({');
    expect(reextract).toContain('runMicroAutoQA({');
    expect(reextract).toContain('persistImprovementLedgerEvents({');
    expect(reextract).toContain('replaceProductPricesForProduct({');
    expect(reextract).not.toContain(".from('product_prices')");
    expect(reextract).not.toContain('.delete()');
    expect(reextract).not.toContain('.insert(priceRowsToInsert)');
    expect(reextract).toContain('withAdminGuard(postHandler)');
    expect(reextract).not.toContain("from '@/lib/parser/extract-itinerary'");
    expect(reextract).not.toContain('extractItineraryData(');
    expect(reextract).not.toContain('raw_extracted_text');
  });
});
