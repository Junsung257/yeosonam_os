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
    const qualityIndex = upload.indexOf('const inputAnalysis = analyzeUploadInputText(directRawText)');
    const duplicateIndex = upload.indexOf("from('document_hashes')");
    const parseIndex = upload.indexOf('let parsedDocument =');

    expect(qualityIndex).toBeGreaterThanOrEqual(0);
    expect(duplicateIndex).toBeGreaterThan(qualityIndex);
    expect(parseIndex).toBeGreaterThan(qualityIndex);
    expect(upload).toContain('INPUT_ENCODING_CORRUPTED');
    expect(upload).toContain('INPUT_WEB_PAGE_COPY');
    expect(upload).toContain('INPUT_NOT_PRODUCT_SOURCE');
  });

  it('does not let force reprocess bypass contaminated direct text', () => {
    const upload = source('src/app/api/upload/route.ts');
    const qualityIndex = upload.indexOf('const inputAnalysis = analyzeUploadInputText(directRawText)');
    const forceIndex = upload.indexOf('const forceReprocess');

    expect(qualityIndex).toBeGreaterThanOrEqual(0);
    expect(forceIndex).toBeGreaterThan(qualityIndex);
  });

  it('blocks catalog product-count mismatches instead of saving partial products', () => {
    const upload = source('src/app/api/upload/route.ts');
    const expectedIndex = upload.indexOf('v3StructurePlanForUpload.expected_products');
    const mismatchCodeIndex = upload.indexOf('PRODUCT_COUNT_MISMATCH');
    const loopIndex = upload.indexOf('for (let productIndex = 0; productIndex < productsToSave.length; productIndex++)');

    expect(expectedIndex).toBeGreaterThanOrEqual(0);
    expect(mismatchCodeIndex).toBeGreaterThan(expectedIndex);
    expect(loopIndex).toBeGreaterThan(mismatchCodeIndex);
  });

  it('keeps upload-created packages in review when V3 is missing or not publishable', () => {
    const upload = source('src/app/api/upload/route.ts');
    const v3Index = upload.indexOf('preSaveV3Result');
    const reviewStatusIndex = upload.indexOf("productStatus = 'REVIEW_NEEDED'", v3Index);
    const pendingIndex = upload.indexOf("pkgStatus = 'pending'", v3Index);

    expect(v3Index).toBeGreaterThanOrEqual(0);
    expect(reviewStatusIndex).toBeGreaterThan(v3Index);
    expect(pendingIndex).toBeGreaterThan(v3Index);
    expect(upload).not.toMatch(/status:\s*'active'[\s\S]{0,200}source_filename/);
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

    expect(upload).not.toMatch(/from\(['"]attractions['"]\)\s*\.\s*(insert|upsert)/);
    expect(upload).toContain("from('unmatched_activities').upsert");
    expect(upload).toContain('shouldAttemptAttractionMatch');
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
