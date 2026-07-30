import {
  buildAttractionOwnerReviewCsv,
  normalizeIdentityVerificationMethod,
  normalizeOfficialSourceUrl,
  normalizeOfficialSourceUrls,
  normalizeOwnerReviewAliases,
  type AttractionIdentityVerificationMethod,
  type AttractionOwnerReviewCsvItem,
} from '@/lib/attraction-owner-review-import';

export type AttractionCandidateTarget = {
  canonicalName: string;
  shortDesc: string;
  longDesc: string;
  country: string;
  region: string;
  badgeType: string;
  emoji: string;
  aliases: string[];
  officialSourceUrl: string;
  supportingSourceUrls?: string[];
  verificationMethod?: AttractionIdentityVerificationMethod;
  evidenceSummary?: string;
};

export type AttractionOwnerReviewDecision =
  | {
      sourcePhrases: string[];
      decision: 'new_master';
      targets: AttractionCandidateTarget[];
      note?: string;
    }
  | {
      sourcePhrases: string[];
      decision: 'existing_alias';
      existingAttractionId: string;
      existingAttractionName: string;
      existingCustomerPublishable: boolean;
      aliases: string[];
      note?: string;
    }
  | {
      sourcePhrases: string[];
      decision: 'hold';
      reason: string;
      requiredConfirmation: string;
    };

export type AttractionRemediationReport = {
  summary?: {
    totalProducts: number;
    customerReadyProducts: number;
  };
  products: Array<{
    sourceFile: string;
    productIndex: number;
    title: string;
    customerReadyOffline: boolean;
    remediation: {
      actions: Array<{
        kind: string;
        field: string;
        sourcePhrases: string[];
      }>;
    };
  }>;
};

export type ActiveAttractionCatalogRow = {
  id: string;
  name: string;
  aliases?: string[] | null;
  is_active?: boolean | null;
  customer_publishable?: boolean | null;
};

export type AttractionOwnerReviewPack = {
  version: 1;
  generatedAt: string;
  sourceReportGeneratedAt?: string;
  summary: {
    totalProducts: number;
    currentCustomerReady: number;
    currentCustomerReadyRate: number;
    attractionBlockedProducts: number;
    uniqueSourcePhrases: number;
    coveredSourcePhrases: number;
    candidateMasters: number;
    existingAliasActions: number;
    heldSourcePhrases: number;
    identityResolvableAttractionProducts: number;
    identityResolvableAttractionOnlyProducts: number;
    theoreticalReadyAfterReviewedIdentityAndCustomerMediaApproval: number;
    theoreticalReadyRateAfterReviewedIdentityAndCustomerMediaApproval: number;
    allAttractionApprovalCeiling: number;
    allAttractionApprovalCeilingRate: number;
    minimumReadyProductsFor95Percent: number;
    minimumSupplierCorrectionsStillRequiredAfterAllAttractions: number;
    activeCatalogRows: number;
    activeCatalogConflicts: number;
  };
  safeguards: {
    writesDatabase: false;
    candidateCsvOwnerReviewed: false;
    candidateCsvCreatesCustomerPublishable: false;
    note: string;
  };
  candidateMasters: AttractionOwnerReviewCsvItem[];
  existingAliasActions: Array<{
    existingAttractionId: string;
    existingAttractionName: string;
    existingCustomerPublishable: boolean;
    aliases: string[];
    sourcePhrases: string[];
    note: string | null;
  }>;
  holds: Array<{
    sourcePhrases: string[];
    reason: string;
    requiredConfirmation: string;
  }>;
  activeCatalogConflicts: Array<{
    sourcePhrase: string;
    decision: AttractionOwnerReviewDecision['decision'];
    existingAttractionId: string;
    existingAttractionName: string;
    matchedCatalogValue: string;
    existingCustomerPublishable: boolean;
    requiredAction: string;
  }>;
  productImpact: Array<{
    sourceFile: string;
    productIndex: number;
    title: string;
    sourcePhrases: string[];
    decision: 'identity_resolvable' | 'held';
    remainingNonAttractionBlockers: string[];
  }>;
};

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

function normalizeMatchKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function attractionActions(product: AttractionRemediationReport['products'][number]) {
  return product.remediation.actions.filter(action => action.kind === 'attraction_review');
}

function uniqueAttractionPhrases(report: AttractionRemediationReport): string[] {
  return [...new Set(
    report.products.flatMap(product =>
      attractionActions(product).flatMap(action => action.sourcePhrases),
    ),
  )];
}

function candidateSignature(target: AttractionCandidateTarget): string {
  return JSON.stringify({
    canonicalName: target.canonicalName.trim(),
    shortDesc: target.shortDesc.trim(),
    longDesc: target.longDesc.trim(),
    country: target.country.trim(),
    region: target.region.trim(),
    badgeType: target.badgeType.trim(),
    emoji: target.emoji.trim(),
    officialSourceUrl: normalizeOfficialSourceUrl(target.officialSourceUrl),
    supportingSourceUrls: normalizeOfficialSourceUrls(target.supportingSourceUrls ?? []).urls,
    verificationMethod: target.verificationMethod ?? 'official_source_review',
    evidenceSummary: (target.evidenceSummary ?? target.longDesc).trim(),
  });
}

function validateTarget(target: AttractionCandidateTarget, errors: string[]): void {
  const required: Array<[keyof AttractionCandidateTarget, string]> = [
    ['canonicalName', '표준명'],
    ['shortDesc', '짧은 설명'],
    ['longDesc', '긴 설명'],
    ['country', '국가'],
    ['region', '지역'],
    ['badgeType', '배지 유형'],
    ['officialSourceUrl', '공식 근거 URL'],
  ];
  for (const [field, label] of required) {
    if (!String(target[field] ?? '').trim()) {
      errors.push(`신규 후보 "${target.canonicalName || '(이름 없음)'}"의 ${label}이(가) 없습니다.`);
    }
  }
  if (target.officialSourceUrl && !normalizeOfficialSourceUrl(target.officialSourceUrl)) {
    errors.push(`신규 후보 "${target.canonicalName}"의 공식 근거 URL이 올바르지 않습니다.`);
  }
  const supportingUrls = normalizeOfficialSourceUrls(target.supportingSourceUrls ?? []);
  if (supportingUrls.invalidValues.length > 0) {
    errors.push(
      `신규 후보 "${target.canonicalName}"의 보조 근거 URL이 올바르지 않습니다: `
      + supportingUrls.invalidValues[0],
    );
  }
  if (
    target.verificationMethod
    && !normalizeIdentityVerificationMethod(target.verificationMethod)
  ) {
    errors.push(`신규 후보 "${target.canonicalName}"의 검증 방식이 올바르지 않습니다.`);
  }
  if (!(target.evidenceSummary ?? target.longDesc).trim()) {
    errors.push(`신규 후보 "${target.canonicalName}"의 신원 확인 근거 요약이 없습니다.`);
  }
}

export function buildAttractionOwnerReviewPack(
  report: AttractionRemediationReport & { generatedAt?: string },
  decisions: AttractionOwnerReviewDecision[],
  generatedAt = new Date().toISOString(),
  activeCatalog: ActiveAttractionCatalogRow[] = [],
): { pack: AttractionOwnerReviewPack; candidateCsv: string } {
  const errors: string[] = [];
  const expectedPhrases = uniqueAttractionPhrases(report);
  const expectedSet = new Set(expectedPhrases);
  const decisionByPhrase = new Map<string, AttractionOwnerReviewDecision>();
  const catalogByMatchKey = new Map<
    string,
    Array<{ row: ActiveAttractionCatalogRow; matchedCatalogValue: string }>
  >();
  for (const row of activeCatalog) {
    if (row.is_active === false) continue;
    for (const value of [row.name, ...(row.aliases ?? [])]) {
      const key = normalizeMatchKey(value);
      if (!key) continue;
      const matches = catalogByMatchKey.get(key) ?? [];
      matches.push({ row, matchedCatalogValue: value });
      catalogByMatchKey.set(key, matches);
    }
  }

  for (const decision of decisions) {
    if (decision.sourcePhrases.length === 0) {
      errors.push('sourcePhrases가 비어 있는 관광지 결정이 있습니다.');
      continue;
    }
    for (const sourcePhrase of decision.sourcePhrases) {
      if (!expectedSet.has(sourcePhrase)) {
        errors.push(`현재 감사 원장에 없는 원문 문구입니다: "${sourcePhrase}"`);
      }
      if (decisionByPhrase.has(sourcePhrase)) {
        errors.push(`원문 문구에 상충하는 결정이 둘 이상입니다: "${sourcePhrase}"`);
      } else {
        decisionByPhrase.set(sourcePhrase, decision);
      }
    }
    if (decision.decision === 'new_master') {
      if (decision.targets.length === 0) errors.push('신규 마스터 결정에 후보가 없습니다.');
      for (const target of decision.targets) validateTarget(target, errors);
    } else if (decision.decision === 'existing_alias') {
      if (!decision.existingAttractionId.trim() || !decision.existingAttractionName.trim()) {
        errors.push(`기존 마스터 별칭 결정의 ID 또는 이름이 없습니다: "${decision.sourcePhrases[0]}"`);
      }
      if (normalizeOwnerReviewAliases(decision.aliases).length === 0) {
        errors.push(`기존 마스터 별칭 결정에 실제 별칭이 없습니다: "${decision.sourcePhrases[0]}"`);
      }
      if (activeCatalog.length > 0) {
        const catalogRow = activeCatalog.find(row => row.id === decision.existingAttractionId);
        if (!catalogRow || catalogRow.is_active === false) {
          errors.push(`기존 마스터 별칭 대상이 active 원장에 없습니다: "${decision.existingAttractionName}"`);
        } else if (catalogRow.name !== decision.existingAttractionName) {
          errors.push(
            `기존 마스터 별칭 대상의 ID와 이름이 다릅니다: `
            + `"${decision.existingAttractionName}" != "${catalogRow.name}"`,
          );
        }
      }
    } else {
      if (!decision.reason.trim() || !decision.requiredConfirmation.trim()) {
        errors.push(`보류 결정에 이유 또는 확인 요청이 없습니다: "${decision.sourcePhrases[0]}"`);
      }
    }
  }

  for (const sourcePhrase of expectedPhrases) {
    if (!decisionByPhrase.has(sourcePhrase)) {
      errors.push(`검수 결정이 누락된 원문 문구입니다: "${sourcePhrase}"`);
    }
  }

  const candidatesByName = new Map<
    string,
    AttractionCandidateTarget & { sourcePhrases: string[] }
  >();
  const candidateSignaturesByName = new Map<string, string>();
  for (const decision of decisions) {
    if (decision.decision !== 'new_master') continue;
    for (const target of decision.targets) {
      const name = target.canonicalName.trim();
      if (activeCatalog.length > 0) {
        for (const value of [name, ...target.aliases]) {
          const exactCatalogMatches = catalogByMatchKey.get(normalizeMatchKey(value)) ?? [];
          if (exactCatalogMatches.length > 0) {
            errors.push(
              `신규 후보 "${name}"의 표준명/별칭 "${value}"이(가) 기존 active 마스터 `
              + `"${exactCatalogMatches.map(match => match.row.name).join(', ')}"와 정확히 충돌합니다. `
              + '신규 생성 대신 existing_alias 결정을 사용해야 합니다.',
            );
          }
        }
      }
      const signature = candidateSignature(target);
      const existingSignature = candidateSignaturesByName.get(name);
      if (existingSignature && existingSignature !== signature) {
        errors.push(`동일 표준명 "${name}"에 서로 다른 후보 정보가 있습니다.`);
        continue;
      }
      candidateSignaturesByName.set(name, signature);
      const existing = candidatesByName.get(name);
      candidatesByName.set(name, {
        ...target,
        aliases: normalizeOwnerReviewAliases([
          ...(existing?.aliases ?? []),
          ...target.aliases,
        ]).filter(alias => alias.toLocaleLowerCase('ko-KR') !== name.toLocaleLowerCase('ko-KR')),
        sourcePhrases: normalizeOwnerReviewAliases([
          ...(existing?.sourcePhrases ?? []),
          ...decision.sourcePhrases,
        ]),
      });
    }
  }

  if (errors.length > 0) {
    throw new Error(`관광지 사장님 검수팩 생성 실패:\n- ${errors.join('\n- ')}`);
  }

  const candidateMasters: AttractionOwnerReviewCsvItem[] = [...candidatesByName.values()]
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName, 'ko'))
    .map(target => ({
      name: target.canonicalName.trim(),
      short_desc: target.shortDesc.trim(),
      long_desc: target.longDesc.trim(),
      country: target.country.trim(),
      region: target.region.trim(),
      badge_type: target.badgeType.trim(),
      emoji: target.emoji.trim(),
      aliases: target.aliases,
      official_source_url: normalizeOfficialSourceUrl(target.officialSourceUrl),
      supporting_source_urls: normalizeOfficialSourceUrls(
        target.supportingSourceUrls ?? [],
      ).urls.filter(url => url !== normalizeOfficialSourceUrl(target.officialSourceUrl)),
      source_phrases: target.sourcePhrases,
      verification_method: target.verificationMethod ?? 'official_source_review',
      evidence_summary: (target.evidenceSummary ?? target.longDesc).trim(),
      owner_reviewed: false,
    }));

  const existingAliasActions = decisions
    .filter((decision): decision is Extract<AttractionOwnerReviewDecision, { decision: 'existing_alias' }> =>
      decision.decision === 'existing_alias',
    )
    .map(decision => ({
      existingAttractionId: decision.existingAttractionId,
      existingAttractionName: decision.existingAttractionName,
      existingCustomerPublishable: decision.existingCustomerPublishable,
      aliases: normalizeOwnerReviewAliases(decision.aliases),
      sourcePhrases: decision.sourcePhrases,
      note: decision.note ?? null,
    }));

  const holds = decisions
    .filter((decision): decision is Extract<AttractionOwnerReviewDecision, { decision: 'hold' }> =>
      decision.decision === 'hold',
    )
    .map(decision => ({
      sourcePhrases: decision.sourcePhrases,
      reason: decision.reason,
      requiredConfirmation: decision.requiredConfirmation,
    }));

  const activeCatalogConflicts = decisions.flatMap(decision =>
    decision.sourcePhrases.flatMap(sourcePhrase => {
      if (decision.decision === 'existing_alias') return [];
      const matches = catalogByMatchKey.get(normalizeMatchKey(sourcePhrase)) ?? [];
      return matches.map(match => ({
        sourcePhrase,
        decision: decision.decision,
        existingAttractionId: match.row.id,
        existingAttractionName: match.row.name,
        matchedCatalogValue: match.matchedCatalogValue,
        existingCustomerPublishable: match.row.customer_publishable === true,
        requiredAction:
          '기존 마스터의 잘못된 별칭인지 사장님이 확인하고, 맞지 않으면 별칭을 제거한 뒤 미매칭 검수를 다시 실행합니다.',
      }));
    }),
  );

  const productImpact = report.products.flatMap(product => {
    const actions = attractionActions(product);
    if (actions.length === 0) return [];
    const sourcePhrases = [...new Set(actions.flatMap(action => action.sourcePhrases))];
    const held = sourcePhrases.some(phrase => decisionByPhrase.get(phrase)?.decision === 'hold');
    return [{
      sourceFile: product.sourceFile,
      productIndex: product.productIndex,
      title: product.title,
      sourcePhrases,
      decision: held ? 'held' as const : 'identity_resolvable' as const,
      remainingNonAttractionBlockers: product.remediation.actions
        .filter(action => action.kind !== 'attraction_review')
        .map(action => action.field),
    }];
  });

  const totalProducts = report.summary?.totalProducts ?? report.products.length;
  const currentCustomerReady = report.summary?.customerReadyProducts
    ?? report.products.filter(product => product.customerReadyOffline).length;
  const attractionOnlyProducts = productImpact.filter(item => item.remainingNonAttractionBlockers.length === 0);
  const identityResolvable = productImpact.filter(item => item.decision === 'identity_resolvable');
  const identityResolvableAttractionOnly = identityResolvable
    .filter(item => item.remainingNonAttractionBlockers.length === 0);
  const theoreticalReady = currentCustomerReady + identityResolvableAttractionOnly.length;
  const allAttractionApprovalCeiling = currentCustomerReady + attractionOnlyProducts.length;
  const minimumReadyProductsFor95Percent = Math.ceil(totalProducts * 0.95);

  const pack: AttractionOwnerReviewPack = {
    version: 1,
    generatedAt,
    sourceReportGeneratedAt: report.generatedAt,
    summary: {
      totalProducts,
      currentCustomerReady,
      currentCustomerReadyRate: percent(currentCustomerReady, totalProducts),
      attractionBlockedProducts: productImpact.length,
      uniqueSourcePhrases: expectedPhrases.length,
      coveredSourcePhrases: decisionByPhrase.size,
      candidateMasters: candidateMasters.length,
      existingAliasActions: existingAliasActions.length,
      heldSourcePhrases: holds.reduce((sum, hold) => sum + hold.sourcePhrases.length, 0),
      identityResolvableAttractionProducts: identityResolvable.length,
      identityResolvableAttractionOnlyProducts: identityResolvableAttractionOnly.length,
      theoreticalReadyAfterReviewedIdentityAndCustomerMediaApproval: theoreticalReady,
      theoreticalReadyRateAfterReviewedIdentityAndCustomerMediaApproval:
        percent(theoreticalReady, totalProducts),
      allAttractionApprovalCeiling,
      allAttractionApprovalCeilingRate: percent(allAttractionApprovalCeiling, totalProducts),
      minimumReadyProductsFor95Percent,
      minimumSupplierCorrectionsStillRequiredAfterAllAttractions:
        Math.max(0, minimumReadyProductsFor95Percent - allAttractionApprovalCeiling),
      activeCatalogRows: activeCatalog.filter(row => row.is_active !== false).length,
      activeCatalogConflicts: activeCatalogConflicts.length,
    },
    safeguards: {
      writesDatabase: false,
      candidateCsvOwnerReviewed: false,
      candidateCsvCreatesCustomerPublishable: false,
      note: '후보 CSV는 owner_reviewed=no로 생성되며, 검수·사진·설명·고객 공개 승인을 대체하지 않습니다.',
    },
    candidateMasters,
    existingAliasActions,
    holds,
    activeCatalogConflicts,
    productImpact,
  };

  return {
    pack,
    candidateCsv: buildAttractionOwnerReviewCsv(candidateMasters),
  };
}
