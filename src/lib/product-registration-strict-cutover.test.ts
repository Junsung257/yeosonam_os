import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return readFileSync(join(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('product registration strict cutover policy', () => {
  it('runs upload input quality checks before duplicate handling and parsing work', () => {
    const upload = source('src/app/api/upload/route.ts');
    const intake = source('src/lib/product-registration/upload-request-intake.ts');
    const intakeCallIndex = upload.indexOf('const intake = await prepareUploadRequestIntake(request)');
    const qualityIndex = intake.indexOf(
      'const inputAnalysis = analyzeUploadInputText(originalRawText ?? directRawText)'
    );
    const duplicateIndex = upload.indexOf(".eq('sha256', intake.fileHash)");
    const sourceStoreIndex = upload.indexOf('const source = await ensureSourceDocumentStored({');
    const workflowIndex = upload.indexOf('const started = await startProductRegistrationWorkflowBySourceId({');

    expect(intakeCallIndex).toBeGreaterThanOrEqual(0);
    expect(qualityIndex).toBeGreaterThanOrEqual(0);
    expect(duplicateIndex).toBeGreaterThan(intakeCallIndex);
    expect(sourceStoreIndex).toBeGreaterThan(duplicateIndex);
    expect(workflowIndex).toBeGreaterThan(sourceStoreIndex);
    expect(upload).not.toContain('runUploadRegistrationPipeline');
    expect(intake).toContain('INPUT_ENCODING_CORRUPTED');
    expect(intake).toContain('INPUT_WEB_PAGE_COPY');
    expect(intake).toContain('INPUT_NOT_PRODUCT_SOURCE');
  });

  it('does not let force reprocess bypass contaminated direct text', () => {
    const intake = source('src/lib/product-registration/upload-request-intake.ts');
    const qualityIndex = intake.indexOf(
      'const inputAnalysis = analyzeUploadInputText(originalRawText ?? directRawText)'
    );
    const forceIndex = intake.indexOf('const forceReprocess');

    expect(qualityIndex).toBeGreaterThanOrEqual(0);
    expect(forceIndex).toBeGreaterThan(qualityIndex);
  });

  it('blocks catalog product-count mismatches instead of saving partial products', () => {
    const upload = source('src/app/api/upload/route.ts');
    const pipeline = source('src/lib/product-registration/upload-registration-pipeline.ts');
    const runner = source('src/lib/product-registration/upload-product-runner.ts');
    const preparation = source('src/lib/product-registration/upload-registration-preparation.ts');
    const preflight = source('src/lib/product-registration/upload-preflight.ts');
    const expectedIndex = preflight.indexOf('const expectedProductCount = structurePlan.expected_products');
    const preparationCallIndex = pipeline.indexOf('const preparedRegistrationProducts = await prepareUploadRegistrationProducts({');
    const preflightCallIndex = preparation.indexOf('const v3CatalogPreflight = await runUploadV3CatalogPreflight({');
    const mismatchCodeIndex = preparation.indexOf('PRODUCT_COUNT_MISMATCH');
    const runnerCallIndex = pipeline.indexOf('const registrationProductsResult = await processUploadRegistrationProducts({');
    const loopIndex = runner.indexOf('for (let productIndex = 0; productIndex < input.productsToSave.length; productIndex++)');

    expect(expectedIndex).toBeGreaterThanOrEqual(0);
    expect(preparationCallIndex).toBeGreaterThanOrEqual(0);
    expect(preflightCallIndex).toBeGreaterThanOrEqual(0);
    expect(mismatchCodeIndex).toBeGreaterThan(preflightCallIndex);
    expect(runnerCallIndex).toBeGreaterThan(preparationCallIndex);
    expect(loopIndex).toBeGreaterThanOrEqual(0);
  });

  it('keeps upload-created packages in review when V3 is missing or not publishable', () => {
    const upload = source('src/app/api/upload/route.ts');
    const runner = source('src/lib/product-registration/upload-product-runner.ts');
    const finalizer = source('src/lib/product-registration/finalize-registration.ts');
    const finalizerCallIndex = runner.indexOf('finalizeUploadRegistration({');
    const gateIndex = finalizer.indexOf("if (uploadGate === 'BLOCKED')");
    const reviewStatusIndex = finalizer.indexOf("productStatus = 'REVIEW_NEEDED'", gateIndex);
    const pendingIndex = finalizer.indexOf("pkgStatus = 'pending'", gateIndex);

    expect(finalizerCallIndex).toBeGreaterThanOrEqual(0);
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(reviewStatusIndex).toBeGreaterThan(gateIndex);
    expect(pendingIndex).toBeGreaterThan(gateIndex);
    expect(upload).not.toMatch(/status:\s*'active'[\s\S]{0,200}source_filename/);
  });

  it('centralizes missing destination resolution before internal code generation', () => {
    const upload = source('src/app/api/upload/route.ts');
    const workflow = source('src/workflows/product-registration-v6.ts');
    const normalizationIndex = workflow.indexOf('const canonical = await normalizeStep(input, preflight');
    const compatibilityIndex = workflow.indexOf('const compatibility = await projectCompatibilityStep(input, canonical)');

    expect(normalizationIndex).toBeGreaterThanOrEqual(0);
    expect(compatibilityIndex).toBeGreaterThan(normalizationIndex);
    expect(workflow).toContain('buildPackageProjectionFromRevision');
    expect(upload).toContain('startProductRegistrationWorkflowBySourceId');
    expect(upload).not.toContain('runUploadRegistrationPipeline');
    expect(upload).not.toContain('processUploadRegistrationProducts');
    expect(upload).not.toContain('extractUploadDestinationFromFilename');
    expect(upload).not.toContain('resolveUploadDestinationAndCodes({');
    expect(upload).not.toContain('applyDeterministicExtractedDataFixes(ed)');
    expect(upload).not.toContain('destination fallback applied before code generation');
    expect(upload).not.toContain('destination 본문 fallback 적용');
    expect(upload).not.toContain('resolveCode(ed.destination');
  });

  it('centralizes malformed price tier rescue before customer deliverable blocking', () => {
    const upload = source('src/app/api/upload/route.ts');
    const runner = source('src/lib/product-registration/upload-product-runner.ts');
    const recoveryIndex = runner.indexOf('const registrationResult: StandardProductRegistrationObject = await registerProductFromRaw({');
    const priceRowsIndex = runner.indexOf('const priceRows = registrationResult.pricing.productPrices', recoveryIndex);
    const priceDatesIndex = runner.indexOf('const projectedPriceDates = registrationResult.pricing.priceDates', recoveryIndex);
    const gateIndex = runner.indexOf('const deliverability = registrationResult.deliverability');

    expect(recoveryIndex).toBeGreaterThanOrEqual(0);
    expect(priceRowsIndex).toBeGreaterThanOrEqual(0);
    expect(priceDatesIndex).toBeGreaterThan(priceRowsIndex);
    expect(gateIndex).toBeGreaterThan(priceDatesIndex);
    expect(upload).not.toContain('recoverUploadPriceData(ed');
    expect(upload).not.toContain('evaluateUploadDeliverability({');
    expect(upload).not.toContain('malformed/empty price gate');
    expect(upload).not.toContain('let priceRows = priceTiersToRows(ed)');
  });

  it('retires mutable package approval so force cannot bypass CAS publication', () => {
    const approve = source('src/app/api/packages/[id]/approve/route.ts');

    expect(approve).toContain('LEGACY_PACKAGE_APPROVAL_RETIRED');
    expect(approve).toContain('CAS publication pointer');
    expect(approve).toContain('{ status: 410');
    expect(approve).not.toContain("status: 'active'");
    expect(approve).not.toContain("from('travel_packages').update");
  });

  it('keeps upload registration free of automatic attraction inserts', () => {
    const upload = source('src/app/api/upload/route.ts');
    const pipeline = source('src/lib/product-registration/upload-registration-pipeline.ts');
    const runner = source('src/lib/product-registration/upload-product-runner.ts');
    const completion = source('src/lib/product-registration/upload-registration-completion.ts');
    const queue = source('src/lib/product-registration/unmatched-queue.ts');

    expect(upload).not.toMatch(/from\(['"]attractions['"]\)\s*\.\s*(insert|upsert)/);
    expect(upload).not.toContain('flushUploadAttractionReviewQueue');
    expect(completion).toContain('flushUploadAttractionReviewQueue');
    expect(upload).not.toContain('queueUploadAttractionReviewCandidates({');
    expect(upload).not.toContain("from('unmatched_activities').upsert");
    expect(queue).toContain('queueUploadAttractionReviewCandidates(input)');
    expect(queue).toContain("from('unmatched_activities').upsert");
    expect(queue).toContain("onConflict: 'unmatched_scope_key,activity'");
    expect(upload).not.toContain('processUploadRegistrationProducts');
    expect(pipeline).toContain('processUploadRegistrationProducts');
    expect(runner).toContain('registerProductFromRaw');
    expect(upload).not.toContain('normalizeUploadItinerary({');
    expect(upload).not.toContain('shouldAttemptAttractionMatch');
    expect(upload).not.toContain('extractAttractionCandidates');
  });

  it('retires unsafe manual customer notice mutations', () => {
    const packagesRoute = source('src/app/api/packages/route.ts');
    const adminReview = source('src/app/admin/packages/[id]/review/page.tsx');
    const standardNoticeRoute = source('src/app/api/admin/packages/[id]/standard-notices/route.ts');

    expect(packagesRoute).toContain('LEGACY_PACKAGE_UPDATE_RETIRED');
    expect(adminReview).toContain('/api/admin/packages/${pkg.id}/standard-notices');
    expect(adminReview).toContain('quality?.v3_draft?.structured_facts');
    expect(adminReview).toContain('정형 키워드 추출 테이블');
    expect(adminReview).toContain('REMARK 표준언어 검수 테이블');
    expect(standardNoticeRoute).toContain('MUTABLE_STANDARD_NOTICE_UPDATE_RETIRED');
    expect(standardNoticeRoute).toContain('/api/admin/product-registration/products/{catalogProductId}/corrections');
  });

  it('retires legacy package approval endpoints in favor of CAS publication', () => {
    const packagesRoute = source('src/app/api/packages/route.ts');
    expect(packagesRoute).toContain('LEGACY_PACKAGE_UPDATE_RETIRED');
    expect(packagesRoute).not.toContain("if (action === 'approve')");
    expect(packagesRoute).not.toContain("if (action === 'bulk_approve')");
    expect(packagesRoute).not.toContain('approvePackage(packageId)');
  });

  it('keeps product-registration paths free of automatic attraction inserts', () => {
    const files = [
      'src/app/api/upload/route.ts',
      'src/app/api/register-via-ir/route.ts',
      'src/lib/ir-to-package.ts',
      'src/lib/product-registration-v3/persist.ts',
      'src/lib/product-registration-v3/matcher.ts',
    ];

    for (const file of files) {
      expect(source(file), file).not.toMatch(/from\(['"]attractions['"]\)\s*\.\s*(insert|upsert)/);
    }
  });

  it('keeps A4 notices behind the V3 raw leak guard', () => {
    const a4 = source('src/components/admin/YeosonamA4Template.tsx');

    expect(a4).toContain('hasSupplierRemarkRawLeakRisk');
    expect(a4).toContain('sanitizeCustomerVisibleNotices');
    expect(a4).toContain('strictStandardOnly: hasV3NoticeMeta');
    expect(a4).toContain('customerNotes && !rawLeakRisk');
  });
});
