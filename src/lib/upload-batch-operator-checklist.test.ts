import { describe, expect, it } from 'vitest';
import type { AttractionOwnerReviewPack } from '@/lib/attraction-owner-review-pack';
import {
  buildUploadBatchOperatorChecklist,
  buildUploadBatchOperatorChecklistCsv,
  buildUploadBatchOperatorChecklistMarkdown,
  buildUploadCommercialMetadataInputCsv,
  type UploadChecklistSourceReport,
} from '@/lib/upload-batch-operator-checklist';

function sourceReport(): UploadChecklistSourceReport {
  const base = {
    rawTextHash: 'a'.repeat(64),
    destination: '쿤밍',
    destinationCode: 'KMG',
    priceRows: 3,
    priceDates: 3,
    itineraryDays: 4,
    commercialMetadataReady: true,
    landOperator: '테스트랜드',
    commissionRate: 10,
  };
  return {
    generatedAt: '2026-07-29T00:00:00.000Z',
    products: [
      {
        ...base,
        sourceFile: 'ready.hwp',
        productIndex: 0,
        title: '즉시 업로드 검증 대상',
        customerReadyOffline: true,
        remediation: { ready: true, actions: [], supplierRequestText: null },
      },
      {
        ...base,
        sourceFile: 'commercial.hwp',
        productIndex: 0,
        title: '상업조건 입력 대상',
        customerReadyOffline: true,
        commercialMetadataReady: false,
        landOperator: null,
        commissionRate: null,
        remediation: {
          ready: false,
          actions: [{
            kind: 'commercial_metadata',
            field: 'commercial_metadata',
            title: '랜드사·계약 커미션 확인',
            instruction: '실제 계약 근거와 일치하는 값을 입력합니다.',
            sourcePhrases: [],
          }],
          supplierRequestText: null,
        },
      },
      {
        ...base,
        sourceFile: 'owner.hwp',
        productIndex: 0,
        title: '관광지 승인 대상',
        customerReadyOffline: false,
        remediation: {
          ready: false,
          actions: [{
            kind: 'attraction_review',
            field: 'attraction_master',
            title: '관광지 검수',
            instruction: '사장님 승인 후 재감사합니다.',
            sourcePhrases: ['공식 후보'],
          }],
          supplierRequestText: null,
        },
      },
      {
        ...base,
        sourceFile: 'combined.hwp',
        productIndex: 0,
        title: '관광지와 최소인원',
        customerReadyOffline: false,
        remediation: {
          ready: false,
          actions: [
            {
              kind: 'attraction_review',
              field: 'attraction_master',
              title: '관광지 검수',
              instruction: '사장님 승인 후 재감사합니다.',
              sourcePhrases: ['공식 후보 2'],
            },
            {
              kind: 'supplier_confirmation',
              field: 'minimum_departure',
              title: '최소 출발 인원',
              instruction: '랜드사 확정값을 받습니다.',
              sourcePhrases: [],
            },
          ],
          supplierRequestText: '최소 출발 인원을 알려주세요.',
        },
      },
      {
        ...base,
        sourceFile: 'hold.hwp',
        productIndex: 0,
        title: '관광지 공식명 보류',
        customerReadyOffline: false,
        remediation: {
          ready: false,
          actions: [{
            kind: 'attraction_review',
            field: 'attraction_master',
            title: '관광지 검수',
            instruction: '공식명을 확인합니다.',
            sourcePhrases: ['모호한 장소'],
          }],
          supplierRequestText: null,
        },
      },
      {
        ...base,
        sourceFile: 'supplier.hwp',
        productIndex: 0,
        title: '랜드사 확인 대상',
        customerReadyOffline: false,
        remediation: {
          ready: false,
          actions: [{
            kind: 'supplier_confirmation',
            field: 'round_trip_flight',
            title: '왕복 항공편',
            instruction: '랜드사 확정값을 받습니다.',
            sourcePhrases: [],
          }],
          supplierRequestText: '왕복 항공편명을 알려주세요.',
        },
      },
    ],
  };
}

function attractionPack(): AttractionOwnerReviewPack {
  return {
    version: 1,
    generatedAt: '2026-07-29T00:00:00.000Z',
    summary: {
      totalProducts: 5,
      currentCustomerReady: 1,
      currentCustomerReadyRate: 20,
      attractionBlockedProducts: 3,
      uniqueSourcePhrases: 3,
      coveredSourcePhrases: 3,
      candidateMasters: 2,
      existingAliasActions: 0,
      heldSourcePhrases: 1,
      identityResolvableAttractionProducts: 2,
      identityResolvableAttractionOnlyProducts: 1,
      theoreticalReadyAfterReviewedIdentityAndCustomerMediaApproval: 2,
      theoreticalReadyRateAfterReviewedIdentityAndCustomerMediaApproval: 40,
      allAttractionApprovalCeiling: 3,
      allAttractionApprovalCeilingRate: 60,
      minimumReadyProductsFor95Percent: 5,
      minimumSupplierCorrectionsStillRequiredAfterAllAttractions: 2,
      activeCatalogRows: 0,
      activeCatalogConflicts: 0,
    },
    safeguards: {
      writesDatabase: false,
      candidateCsvOwnerReviewed: false,
      candidateCsvCreatesCustomerPublishable: false,
      note: 'test',
    },
    candidateMasters: [],
    existingAliasActions: [],
    holds: [{
      sourcePhrases: ['모호한 장소'],
      reason: '공식 장소 식별값이 없습니다.',
      requiredConfirmation: '공식 중국어명, 주소, 지도 링크를 회신해 주세요.',
    }],
    activeCatalogConflicts: [],
    productImpact: [
      {
        sourceFile: 'owner.hwp',
        productIndex: 0,
        title: '관광지 승인 대상',
        sourcePhrases: ['공식 후보'],
        decision: 'identity_resolvable',
        remainingNonAttractionBlockers: [],
      },
      {
        sourceFile: 'combined.hwp',
        productIndex: 0,
        title: '관광지와 최소인원',
        sourcePhrases: ['공식 후보 2'],
        decision: 'identity_resolvable',
        remainingNonAttractionBlockers: ['minimum_departure'],
      },
      {
        sourceFile: 'hold.hwp',
        productIndex: 0,
        title: '관광지 공식명 보류',
        sourcePhrases: ['모호한 장소'],
        decision: 'held',
        remainingNonAttractionBlockers: [],
      },
    ],
  };
}

describe('buildUploadBatchOperatorChecklist', () => {
  it('creates an exhaustive one-by-one operating order without authorizing customer opening', () => {
    const checklist = buildUploadBatchOperatorChecklist(
      sourceReport(),
      attractionPack(),
      '2026-07-29T01:00:00.000Z',
    );

    expect(checklist.summary).toMatchObject({
      products: 6,
      readyForAdminUpload: 1,
      commercialMetadataRequired: 1,
      customerOpenAllowedWithoutFreshProof: 0,
      supplierConfirmation: 1,
      ownerReviewCandidateOnly: 1,
      ownerAndSupplier: 1,
      attractionIdentityHold: 1,
      systemRepair: 0,
      minimumProductsFor95Percent: 6,
    });
    expect(checklist.rows.every(row => row.customerOpenAllowed === false)).toBe(true);
    expect(checklist.rows[0]).toMatchObject({
      phase: 'ready_for_admin_upload',
      readyForAdminUpload: true,
      customerOpenAllowed: false,
      sequence: 1,
    });
    expect(checklist.rows[1]).toMatchObject({
      phase: 'commercial_metadata_then_reaudit',
      sourceFile: 'commercial.hwp',
      commercialMetadataReady: false,
      landOperator: null,
      commissionRate: null,
    });
    expect(checklist.rows[0].postUploadProofRequired).toContain(
      '/lp/{id} 모바일 브라우저 증명 및 CTA 열림',
    );
    const identityHold = checklist.rows.find(row => row.sourceFile === 'hold.hwp');
    expect(identityHold?.requiredActions).toContain(
      '관광지 공식 정보 확인: 공식 중국어명, 주소, 지도 링크를 회신해 주세요.',
    );
    expect(identityHold?.supplierRequestText).toContain('상품:');
    expect(identityHold?.supplierRequestText).toContain('관광지 공식 정보 확인 요청');
    expect(identityHold?.supplierRequestText).toContain(
      '공식 중국어명, 주소, 지도 링크를 회신해 주세요.',
    );
  });

  it('emits readable CSV and Markdown for non-technical one-by-one review', () => {
    const checklist = buildUploadBatchOperatorChecklist(sourceReport(), attractionPack());
    const csv = buildUploadBatchOperatorChecklistCsv(checklist);
    const commercialCsv = buildUploadCommercialMetadataInputCsv(checklist);
    const markdown = buildUploadBatchOperatorChecklistMarkdown(checklist);

    expect(csv).toContain('현재_고객공개가능');
    expect(csv).toContain('계약커미션율_확정값');
    expect(csv).toContain('"아니오"');
    expect(commercialCsv).toContain('계약_커미션율_퍼센트');
    expect(commercialCsv).toContain(
      '"commercial.hwp","1","상업조건 입력 대상","","","입력 필요"',
    );
    expect(markdown).toContain('# HWP 71개 상품 한 건씩 업로드 체크리스트');
    expect(markdown).toContain('상품별 상업조건 입력표');
    expect(markdown).toContain('1차 admin/upload 검증 대상');
    expect(markdown).toContain('실제 등록 후 공통 공개 증명');
  });

  it('fails closed when an attraction-blocked product is absent from the owner review pack', () => {
    const invalidPack = attractionPack();
    invalidPack.productImpact = invalidPack.productImpact.filter(
      item => item.sourceFile !== 'hold.hwp',
    );

    expect(() => buildUploadBatchOperatorChecklist(sourceReport(), invalidPack))
      .toThrow('관광지 검수팩에 상품이 없습니다');
  });

  it('fails closed when a blocked product has no operator action', () => {
    const invalidReport = sourceReport();
    const blocked = invalidReport.products.find(product => product.sourceFile === 'supplier.hwp');
    if (!blocked) throw new Error('fixture missing');
    blocked.remediation.actions = [];

    expect(() => buildUploadBatchOperatorChecklist(invalidReport, attractionPack()))
      .toThrow('보류 상품에 운영 조치가 없습니다');
  });

  it('fails closed when an identity hold has no supplier confirmation request', () => {
    const invalidPack = attractionPack();
    invalidPack.holds = [];

    expect(() => buildUploadBatchOperatorChecklist(sourceReport(), invalidPack))
      .toThrow('공식 식별 보류 상품에 공급사 확인 요청이 없습니다');
  });
});
