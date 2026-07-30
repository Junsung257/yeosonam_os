import { describe, expect, it } from 'vitest';
import {
  buildAttractionOwnerReviewPack,
  type AttractionOwnerReviewDecision,
  type AttractionRemediationReport,
} from '@/lib/attraction-owner-review-pack';

function report(): AttractionRemediationReport & { generatedAt: string } {
  return {
    generatedAt: '2026-07-29T00:00:00.000Z',
    products: [
      {
        sourceFile: 'ready.hwp',
        productIndex: 0,
        title: '현재 오픈 가능',
        customerReadyOffline: true,
        remediation: { actions: [] },
      },
      {
        sourceFile: 'candidate.hwp',
        productIndex: 0,
        title: '관광지만 막힘',
        customerReadyOffline: false,
        remediation: {
          actions: [{
            kind: 'attraction_review',
            field: 'attraction_master',
            sourcePhrases: ['공식 후보 문구'],
          }],
        },
      },
      {
        sourceFile: 'hold.hwp',
        productIndex: 0,
        title: '모호한 관광지',
        customerReadyOffline: false,
        remediation: {
          actions: [{
            kind: 'attraction_review',
            field: 'attraction_master',
            sourcePhrases: ['모호한 문구'],
          }],
        },
      },
      {
        sourceFile: 'supplier.hwp',
        productIndex: 0,
        title: '관광지와 최소인원',
        customerReadyOffline: false,
        remediation: {
          actions: [
            {
              kind: 'attraction_review',
              field: 'attraction_master',
              sourcePhrases: ['공식 후보 문구'],
            },
            {
              kind: 'supplier_confirmation',
              field: 'minimum_departure',
              sourcePhrases: [],
            },
          ],
        },
      },
    ],
  };
}

function decisions(): AttractionOwnerReviewDecision[] {
  return [
    {
      sourcePhrases: ['공식 후보 문구'],
      decision: 'new_master',
      targets: [{
        canonicalName: '공식 후보',
        shortDesc: '공식 확인 후보',
        longDesc: '공식 근거에서 장소의 명칭과 지역을 확인한 후보입니다.',
        country: '중국',
        region: '운남',
        badgeType: 'tour',
        emoji: '📍',
        aliases: ['공식 후보 문구', '공식 후보'],
        officialSourceUrl: 'https://example.gov/official-place',
      }],
    },
    {
      sourcePhrases: ['모호한 문구'],
      decision: 'hold',
      reason: '동명 장소가 있어 특정할 수 없습니다.',
      requiredConfirmation: '랜드사에 공식명과 주소를 요청합니다.',
    },
  ];
}

describe('buildAttractionOwnerReviewPack', () => {
  it('covers every phrase but keeps every generated candidate unapproved and internal-only', () => {
    const { pack, candidateCsv } = buildAttractionOwnerReviewPack(
      report(),
      decisions(),
      '2026-07-29T01:00:00.000Z',
    );

    expect(pack.summary).toMatchObject({
      totalProducts: 4,
      currentCustomerReady: 1,
      uniqueSourcePhrases: 2,
      coveredSourcePhrases: 2,
      candidateMasters: 1,
      heldSourcePhrases: 1,
      identityResolvableAttractionProducts: 2,
      identityResolvableAttractionOnlyProducts: 1,
      theoreticalReadyAfterReviewedIdentityAndCustomerMediaApproval: 2,
      allAttractionApprovalCeiling: 3,
      minimumReadyProductsFor95Percent: 4,
      minimumSupplierCorrectionsStillRequiredAfterAllAttractions: 1,
    });
    expect(pack.candidateMasters[0]).toMatchObject({
      name: '공식 후보',
      aliases: ['공식 후보 문구'],
      source_phrases: ['공식 후보 문구'],
      verification_method: 'official_source_review',
      evidence_summary: '공식 근거에서 장소의 명칭과 지역을 확인한 후보입니다.',
      owner_reviewed: false,
    });
    expect(pack.safeguards).toMatchObject({
      writesDatabase: false,
      candidateCsvOwnerReviewed: false,
      candidateCsvCreatesCustomerPublishable: false,
    });
    expect(candidateCsv).toContain('"no"');
    expect(candidateCsv).not.toContain('"yes"');
    expect(candidateCsv).toContain('source_phrases');
    expect(candidateCsv).toContain('verification_method');
  });

  it('calculates the 95 percent ceiling against the full audit, not only the blocked subset', () => {
    const blockedOnly = report();
    blockedOnly.summary = {
      totalProducts: 71,
      customerReadyProducts: 48,
    };
    blockedOnly.products = blockedOnly.products.filter(product => !product.customerReadyOffline);

    const { pack } = buildAttractionOwnerReviewPack(
      blockedOnly,
      decisions(),
      '2026-07-29T01:00:00.000Z',
    );

    expect(pack.summary).toMatchObject({
      totalProducts: 71,
      currentCustomerReady: 48,
      theoreticalReadyAfterReviewedIdentityAndCustomerMediaApproval: 49,
      allAttractionApprovalCeiling: 50,
      minimumReadyProductsFor95Percent: 68,
      minimumSupplierCorrectionsStillRequiredAfterAllAttractions: 18,
    });
  });

  it('fails closed when even one current source phrase has no decision', () => {
    expect(() => buildAttractionOwnerReviewPack(report(), decisions().slice(0, 1)))
      .toThrow('검수 결정이 누락된 원문 문구');
  });

  it('fails closed on an unknown or duplicated source phrase', () => {
    const invalid: AttractionOwnerReviewDecision[] = [
      ...decisions(),
      {
        sourcePhrases: ['공식 후보 문구', '감사 원장에 없음'],
        decision: 'hold',
        reason: '중복',
        requiredConfirmation: '확인',
      },
    ];

    expect(() => buildAttractionOwnerReviewPack(report(), invalid))
      .toThrow(/현재 감사 원장에 없는|상충하는 결정/);
  });

  it('fails closed when official evidence URL is not http(s)', () => {
    const invalid = decisions();
    const candidate = invalid[0];
    if (candidate.decision !== 'new_master') throw new Error('invalid fixture');
    candidate.targets[0].officialSourceUrl = 'not-a-url';

    expect(() => buildAttractionOwnerReviewPack(report(), invalid))
      .toThrow('공식 근거 URL이 올바르지 않습니다');
  });

  it('fails closed when a new candidate name or alias already exists in the active catalog', () => {
    expect(() => buildAttractionOwnerReviewPack(
      report(),
      decisions(),
      '2026-07-29T01:00:00.000Z',
      [{
        id: 'existing-1',
        name: '공식 후보',
        aliases: [],
        is_active: true,
        customer_publishable: false,
      }],
    )).toThrow('신규 생성 대신 existing_alias 결정을 사용해야 합니다');
  });

  it('reports an exact existing alias conflict for a held source phrase without mutating it', () => {
    const { pack } = buildAttractionOwnerReviewPack(
      report(),
      decisions(),
      '2026-07-29T01:00:00.000Z',
      [{
        id: 'wrong-master',
        name: '다른 관광지',
        aliases: ['모호한 문구'],
        is_active: true,
        customer_publishable: true,
      }],
    );

    expect(pack.summary.activeCatalogConflicts).toBe(1);
    expect(pack.activeCatalogConflicts).toEqual([
      expect.objectContaining({
        sourcePhrase: '모호한 문구',
        decision: 'hold',
        existingAttractionId: 'wrong-master',
        existingAttractionName: '다른 관광지',
        existingCustomerPublishable: true,
      }),
    ]);
    expect(pack.safeguards.writesDatabase).toBe(false);
  });
});
