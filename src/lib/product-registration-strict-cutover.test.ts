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
    const pipeline = source('src/lib/product-registration/upload-registration-pipeline.ts');
    const intake = source('src/lib/product-registration/upload-request-intake.ts');
    const intakeCallIndex = upload.indexOf('const intake = await prepareUploadRequestIntake(request)');
    const qualityIndex = intake.indexOf('const inputAnalysis = analyzeUploadInputText(directRawText)');
    const pipelineCallIndex = upload.indexOf('const result = await runUploadRegistrationPipeline({');
    const duplicateIndex = pipeline.indexOf('const initialDuplicate = await checkInitialUploadDuplicate({');
    const parseIndex = pipeline.indexOf('const parsedForRegistration = await parseUploadDocumentForRegistration({');

    expect(intakeCallIndex).toBeGreaterThanOrEqual(0);
    expect(pipelineCallIndex).toBeGreaterThan(intakeCallIndex);
    expect(qualityIndex).toBeGreaterThanOrEqual(0);
    expect(duplicateIndex).toBeGreaterThanOrEqual(0);
    expect(parseIndex).toBeGreaterThan(duplicateIndex);
    expect(intake).toContain('INPUT_ENCODING_CORRUPTED');
    expect(intake).toContain('INPUT_WEB_PAGE_COPY');
    expect(intake).toContain('INPUT_NOT_PRODUCT_SOURCE');
  });

  it('does not let force reprocess bypass contaminated direct text', () => {
    const intake = source('src/lib/product-registration/upload-request-intake.ts');
    const qualityIndex = intake.indexOf('const inputAnalysis = analyzeUploadInputText(directRawText)');
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
    const pipeline = source('src/lib/product-registration/upload-registration-pipeline.ts');
    const runner = source('src/lib/product-registration/upload-product-runner.ts');
    const registrationIndex = runner.indexOf('const registrationResult: StandardProductRegistrationObject = await registerProductFromRaw({');
    const gateIndex = runner.indexOf('const deliverability = registrationResult.deliverability', registrationIndex);
    const resolutionIndex = runner.indexOf('const destinationResolution = registrationResult.destination', gateIndex);
    const internalCodeIndex = runner.indexOf('issueUploadInternalCode({', resolutionIndex);

    expect(registrationIndex).toBeGreaterThanOrEqual(0);
    expect(gateIndex).toBeGreaterThan(registrationIndex);
    expect(resolutionIndex).toBeGreaterThan(gateIndex);
    expect(internalCodeIndex).toBeGreaterThan(resolutionIndex);
    expect(upload).toContain('runUploadRegistrationPipeline');
    expect(upload).not.toContain('processUploadRegistrationProducts');
    expect(pipeline).toContain('processUploadRegistrationProducts');
    expect(pipeline).toContain('resolveUploadSourceForRegistration');
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

  it('keeps approval blocked by latest V3 draft even when force approval is requested', () => {
    const approve = source('src/app/api/packages/[id]/approve/route.ts');
    const v3GateIndex = approve.indexOf('if (v3NoticeGate.blocksApproval)');
    const forceRequiredIndex = approve.indexOf("if (publishGate.decision === 'force_required' && !force)");
    const activeIndex = approve.search(/status:\s*'active'/);

    expect(v3GateIndex).toBeGreaterThanOrEqual(0);
    expect(forceRequiredIndex).toBeGreaterThan(v3GateIndex);
    expect(activeIndex).toBeGreaterThan(v3GateIndex);
    expect(approve.slice(v3GateIndex, forceRequiredIndex)).toContain('{ status: 409 }');
    expect(approve).toContain('calculateProductRegistrationTrustScore');
    expect(approve).toContain('trust_score: approvalTrustScore');
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

  it('blocks unsafe manual customer notice mutations outside the V3 review save API', () => {
    const packagesRoute = source('src/app/api/packages/route.ts');
    const adminReview = source('src/app/admin/packages/[id]/review/page.tsx');
    const standardNoticeRoute = source('src/app/api/admin/packages/[id]/standard-notices/route.ts');

    expect(packagesRoute).toContain('hasUnsafeCustomerNoticeMutation');
    expect(packagesRoute).toContain('assertPackageV3NoticePatchAllowed');
    expect(packagesRoute).toContain('UNSAFE_CUSTOMER_NOTICE_MUTATION');
    expect(adminReview).toContain('/api/admin/packages/${pkg.id}/standard-notices');
    expect(adminReview).toContain('quality?.v3_draft?.structured_facts');
    expect(adminReview).toContain('정형 키워드 추출 테이블');
    expect(adminReview).toContain('REMARK 표준언어 검수 테이블');
    expect(standardNoticeRoute).toContain('product_registration_drafts');
    expect(standardNoticeRoute).toContain('ledger: nextLedger');
    expect(standardNoticeRoute).toContain('notices_parsed: built.payload.notices_parsed');
    expect(standardNoticeRoute).toContain('customer_notes: built.payload.customer_notes');
  });

  it('keeps legacy package approval endpoints behind the V3 draft gate', () => {
    const packagesRoute = source('src/app/api/packages/route.ts');
    const approveActionIndex = packagesRoute.indexOf("if (action === 'approve')");
    const gateIndex = packagesRoute.indexOf('assertPackageV3ApprovalAllowed(packageId)', approveActionIndex);
    const approvePackageIndex = packagesRoute.indexOf('approvePackage(packageId)', approveActionIndex);
    const bulkApproveIndex = packagesRoute.indexOf("if (action === 'bulk_approve')");
    const bulkGateIndex = packagesRoute.indexOf('V3_DRAFT_BLOCKS_BULK_APPROVAL', bulkApproveIndex);
    const bulkUpdateIndex = packagesRoute.indexOf("status: 'approved'", bulkApproveIndex);

    expect(gateIndex).toBeGreaterThan(approveActionIndex);
    expect(approvePackageIndex).toBeGreaterThan(gateIndex);
    expect(bulkGateIndex).toBeGreaterThan(bulkApproveIndex);
    expect(bulkUpdateIndex).toBeGreaterThan(bulkGateIndex);
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
