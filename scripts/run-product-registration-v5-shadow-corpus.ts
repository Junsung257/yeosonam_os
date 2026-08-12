import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, extname, join, resolve } from 'node:path';

import { parseHwpFileWithRhwp } from '@/lib/product-registration-v4/rhwp';
import { buildCanonicalNormalization } from '@/lib/product-registration-v4/canonical-worker';
import { buildProductRegistrationV5Revision, type ProductRegistrationV5RevisionBuild } from '@/lib/product-registration-v4/revision';
import { buildV5ItineraryItems, buildV5PriceRules } from '@/lib/product-registration-v4/typed-projections';
import { renderPackage, type RenderPackageInput } from '@/lib/render-contract';

type JsonObject = Record<string, unknown>;

type DocumentResult = {
  filename: string;
  sourceHash: string;
  bytes: number;
  parser: string | null;
  extraction: {
    success: boolean;
    pages: number;
    tables: number;
    chars: number;
    error: string | null;
  };
  normalization: {
    success: boolean;
    status: string | null;
    sectionCount: number;
    segmentationSource: string | null;
    gateStatusCounts: Record<string, number>;
    error: string | null;
  };
  sections: Array<{
    index: number;
    titleHint: string | null;
    rawTextHash: string;
    gateStatus: string;
    classification: 'verified' | 'degraded' | 'blocked';
    criticalFailures: string[];
    highWarnings: string[];
    renderContractPass: boolean;
    renderContractError: string | null;
    expectedProducts: number | null;
    variantCount: number;
    priceRuleCount: number;
    itineraryItemCount: number;
    claimCount: number;
    criticalClaimCount: number;
    missingCriticalClaimCount: number;
    highClaimCount: number;
    missingHighClaimCount: number;
    match: {
      attractionUnmatched: number;
      optionReview: number;
      unknownCustomerVisible: number;
      entityReview: number;
      entityUnresolved: number;
    };
    customerPreview: {
      title: string | null;
      priceCount: number;
      firstPrice: number | null;
      currency: string | null;
      dateCount: number;
      flightCount: number;
      dayCount: number;
      inclusionCount: number;
      exclusionCount: number;
      optionalTourCount: number;
      sampleDayTitles: string[];
      customerReady: boolean;
    };
  }>;
};

type CorpusReport = {
  generatedAt: string;
  mode: 'offline-shadow-quarantine';
  publicExposure: 'none';
  sourceDirectory: string;
  totals: {
    files: number;
    extractionSuccess: number;
    normalizationSuccess: number;
    sections: number;
    verified: number;
    degraded: number;
    autoPublishable: number;
    blocked: number;
    renderContractPass: number;
    renderContractFail: number;
    priceRules: number;
    itineraryItems: number;
    claims: number;
    criticalClaims: number;
    missingCriticalClaims: number;
    highClaims: number;
    missingHighClaims: number;
    verifiedClaims: number;
  };
  rates: {
    extractionSuccess: number;
    normalizationSuccess: number;
    sectionVerified: number;
    sectionDegraded: number;
    sectionAutoPublishable: number;
    sectionBlocked: number;
    evidenceCoverage: number;
    renderContractPass: number;
  };
  customerVerdict: {
    status: 'not_ready_for_open' | 'limited_automated_pilot' | 'customer_ready_candidate';
    summary: string;
    rationale: string[];
  };
  documents: DocumentResult[];
};

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((out, value) => {
    out[value] = (out[value] ?? 0) + 1;
    return out;
  }, {});
}

function statusLabel(value: unknown): string {
  return asString(value) ?? 'unknown';
}

function gateChecks(section: JsonObject): { status: string; criticalFailures: string[]; highWarnings: string[] } {
  const v3 = asObject(section.v3);
  const gate = asObject(v3?.gate_result);
  const checks = asArray(gate?.checks).map(asObject).filter((check): check is JsonObject => Boolean(check));
  const criticalFailures = checks
    .filter(check => statusLabel(check.status) === 'fail' && statusLabel(check.severity) === 'critical')
    .map(check => `${statusLabel(check.id)}:${statusLabel(check.message)}`);
  const highWarnings = checks
    .filter(check => (statusLabel(check.status) === 'fail' || statusLabel(check.status) === 'warn') && statusLabel(check.severity) !== 'critical')
    .map(check => `${statusLabel(check.id)}:${statusLabel(check.message)}`);
  return { status: statusLabel(gate?.status), criticalFailures, highWarnings };
}

function matchSummary(section: JsonObject): DocumentResult['sections'][number]['match'] {
  const v3 = asObject(section.v3);
  const match = asObject(v3?.match_summary);
  const entities = asObject(match?.entity_summary);
  const counts = asObject(entities?.counts) ?? {};
  const reviewItems = asArray(entities?.review_items).map(asObject).filter((item): item is JsonObject => Boolean(item));
  return {
    attractionUnmatched: asNumber(match?.attraction_unmatched_count) ?? 0,
    optionReview: asNumber(match?.option_review_count) ?? 0,
    unknownCustomerVisible: reviewItems.filter(item => item.customer_visible === true && statusLabel(item.category) === 'unknown').length,
    entityReview: asNumber(entities?.review_required_count) ?? reviewItems.length,
    entityUnresolved: asNumber(counts.unmatched) ?? asNumber(counts.unknown) ?? 0,
  };
}

function renderPreview(input: RenderPackageInput): DocumentResult['sections'][number]['customerPreview'] {
  const view = renderPackage(input);
  const days = Array.isArray(view.days) ? view.days : [];
  const priceDates = Array.isArray(input.price_dates) ? input.price_dates : [];
  const inclusions = view.inclusions?.basic ?? [];
  const exclusions = view.excludes?.basic ?? [];
  const optionalTours = Array.isArray(view.optionalTours?.flat) ? view.optionalTours.flat : [];
  const sampleDayTitles = days.flatMap(day => Array.isArray(day.schedule) ? day.schedule : [])
    .map(item => asString(item.activity))
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
  return {
    title: asString(input.title),
    priceCount: priceDates.length,
    firstPrice: asNumber(priceDates[0]?.price),
    currency: priceDates.length > 0 ? 'KRW' : null,
    dateCount: priceDates.filter(item => typeof item.date === 'string' && item.date.length > 0).length,
    flightCount: Array.isArray(input.itinerary_data?.flight_segments) ? input.itinerary_data!.flight_segments!.length : 0,
    dayCount: days.length,
    inclusionCount: inclusions.length,
    exclusionCount: exclusions.length,
    optionalTourCount: optionalTours.length,
    sampleDayTitles,
    customerReady: Boolean(asString(input.title)) && days.length > 0 && (priceDates.length > 0 || input.product_type === 'cruise' || input.product_type === 'ferry'),
  };
}

function sectionResult(input: {
  section: JsonObject;
  index: number;
  normalizationSections: Array<{ titleHint: string | null; rawTextHash: string }>;
  revision: ProductRegistrationV5RevisionBuild;
  revisionId: string;
}): DocumentResult['sections'][number] {
  const { status, criticalFailures, highWarnings } = gateChecks(input.section);
  const v3 = asObject(input.section.v3);
  const ledger = asObject(v3?.ledger);
  const variants = asArray(ledger?.variants);
  const priceRules = buildV5PriceRules({ revisionId: input.revisionId, canonicalPayload: { sections: [input.section] } });
  const itineraryItems = buildV5ItineraryItems({ revisionId: input.revisionId, canonicalPayload: { sections: [input.section] } });
  const claims = input.revision.claims.filter(claim => claim.fieldPath.startsWith(`sections[${input.index}]`));
  const criticalClaims = claims.filter(claim => claim.criticality === 'critical');
  const highClaims = claims.filter(claim => claim.criticality === 'high');
  const missingCritical = criticalClaims.filter(claim => claim.evidenceStatus !== 'verified');
  const missingHigh = highClaims.filter(claim => claim.evidenceStatus !== 'verified');
  const previews = asArray(v3?.render_contract_preview).map(value => value as RenderPackageInput);
  let renderContractPass = previews.length > 0;
  let renderContractError: string | null = null;
  const rendered = [] as DocumentResult['sections'][number]['customerPreview'][];
  try {
    for (const preview of previews) rendered.push(renderPreview(preview));
  } catch (error) {
    renderContractPass = false;
    renderContractError = error instanceof Error ? error.message : String(error);
  }
  if (previews.length === 0) {
    renderContractPass = false;
    renderContractError = 'RENDER_CONTRACT_PREVIEW_EMPTY';
  }
  const customerPreview = rendered[0] ?? {
    title: input.normalizationSections[input.index]?.titleHint ?? null,
    priceCount: 0,
    firstPrice: null,
    currency: null,
    dateCount: 0,
    flightCount: 0,
    dayCount: 0,
    inclusionCount: 0,
    exclusionCount: 0,
    optionalTourCount: 0,
    sampleDayTitles: [],
    customerReady: false,
  };
  const match = matchSummary(input.section);
  const safeDegradedGateFailure = (reason: string) => /\.(?:flight|flight_times_complete|hotel_or_notice):/.test(reason);
  const unsafeCriticalFailures = criticalFailures.filter(reason => !safeDegradedGateFailure(reason));
  const safeCriticalFailures = criticalFailures.filter(safeDegradedGateFailure);
  const completeness = asObject(input.section.completeness);
  const completenessOutcome = statusLabel(completeness?.publicationOutcome);
  const completenessBlockers = asArray(completeness?.blockers).map(String);
  const completenessDegraded = asArray(completeness?.degradedReasons).map(String);
  const blockers = [
    ...unsafeCriticalFailures,
    ...completenessBlockers,
    ...missingCritical.map(claim => `MISSING_CRITICAL_EVIDENCE:${claim.fieldPath}`),
    ...(completenessOutcome === 'blocked' && completenessBlockers.length === 0 ? ['CANONICAL_COMPLETENESS_BLOCKED'] : []),
    ...(!renderContractPass ? [`RENDER_CONTRACT:${renderContractError ?? 'failed'}`] : []),
  ];
  const reviewReasons = [
    ...safeCriticalFailures,
    ...completenessDegraded,
    ...highWarnings,
    ...missingHigh.map(claim => `MISSING_HIGH_EVIDENCE:${claim.fieldPath}`),
    ...(match.attractionUnmatched > 0 ? [`ATTRACTION_UNMATCHED:${match.attractionUnmatched}`] : []),
    ...(match.optionReview > 0 ? [`OPTION_REVIEW:${match.optionReview}`] : []),
    ...(match.unknownCustomerVisible > 0 ? [`UNKNOWN_CUSTOMER_VISIBLE:${match.unknownCustomerVisible}`] : []),
    ...(status === 'needs_review' ? ['LEGACY_GATE_REVIEW_CONVERTED_TO_V6_DEGRADED'] : []),
    ...(previews.length > 1 ? [`MULTIPLE_RENDER_VARIANTS:${previews.length}`] : []),
  ];
  const classification = blockers.length > 0 ? 'blocked' : reviewReasons.length > 0 ? 'degraded' : 'verified';
  return {
    index: input.index,
    titleHint: input.normalizationSections[input.index]?.titleHint ?? null,
    rawTextHash: input.normalizationSections[input.index]?.rawTextHash ?? '',
    gateStatus: status,
    classification,
    criticalFailures: blockers.slice(0, 20),
    highWarnings: reviewReasons.slice(0, 20),
    renderContractPass,
    renderContractError,
    expectedProducts: asNumber(asObject(v3?.structure_plan)?.expected_products),
    variantCount: variants.length,
    priceRuleCount: priceRules.length,
    itineraryItemCount: itineraryItems.length,
    claimCount: claims.length,
    criticalClaimCount: criticalClaims.length,
    missingCriticalClaimCount: missingCritical.length,
    highClaimCount: highClaims.length,
    missingHighClaimCount: missingHigh.length,
    match,
    customerPreview,
  };
}

async function processFile(filePath: string): Promise<DocumentResult> {
  const buffer = await readFile(filePath);
  const filename = basename(filePath);
  const sourceHash = sha256(buffer);
  const result: DocumentResult = {
    filename,
    sourceHash,
    bytes: buffer.byteLength,
    parser: null,
    extraction: { success: false, pages: 0, tables: 0, chars: 0, error: null },
    normalization: { success: false, status: null, sectionCount: 0, segmentationSource: null, gateStatusCounts: {}, error: null },
    sections: [],
  };
  try {
    const parsed = await parseHwpFileWithRhwp({ path: filePath, filename, sourceType: 'hwp' });
    result.parser = parsed.parserBinary;
    result.extraction = {
      success: true,
      pages: parsed.ir.pages,
      tables: parsed.ir.tables.length,
      chars: parsed.text.length,
      error: null,
    };
    const sourceDocumentId = `offline-source:${sourceHash}`;
    const extractionId = `offline-extraction:${sha256(`${sourceHash}:${parsed.parserBinary}`)}`;
    const normalization = await buildCanonicalNormalization({ documentIr: parsed.ir, sourceDocumentId, extractionId });
    result.normalization = {
      success: true,
      status: normalization.status,
      sectionCount: normalization.qualityDiagnostics.sectionCount,
      segmentationSource: normalization.qualityDiagnostics.segmentationSource,
      gateStatusCounts: countBy(normalization.qualityDiagnostics.gateStatuses),
      error: null,
    };
    const jobId = `offline-job:${sourceHash}`;
    const normalizationId = `offline-normalization:${sha256(`${normalization.rawTextHash}:${normalization.version}`)}`;
    const revision = buildProductRegistrationV5Revision({
      tenantId: null,
      packageId: null,
      jobId,
      normalizationId,
      sourceDocumentId,
      extractionId,
      revisionNo: 1,
      normalization,
    });
    const sections = asArray(normalization.canonicalPayload.sections).map(value => asObject(value)).filter((value): value is JsonObject => Boolean(value));
    result.sections = sections.map((section, index) => sectionResult({
      section,
      index,
      normalizationSections: normalization.sections,
      revision,
      revisionId: `offline-revision:${revision.payloadHash}`,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!result.extraction.success) result.extraction.error = message;
    else result.normalization.error = message;
  }
  return result;
}

function aggregate(input: { sourceDirectory: string; documents: DocumentResult[] }): CorpusReport {
  const sections = input.documents.flatMap(document => document.sections);
  const extractionSuccess = input.documents.filter(document => document.extraction.success).length;
  const normalizationSuccess = input.documents.filter(document => document.normalization.success).length;
  const verified = sections.filter(section => section.classification === 'verified').length;
  const degraded = sections.filter(section => section.classification === 'degraded').length;
  const autoPublishable = verified + degraded;
  const blocked = sections.filter(section => section.classification === 'blocked').length;
  const renderContractPass = sections.filter(section => section.renderContractPass).length;
  const totals = {
    files: input.documents.length,
    extractionSuccess,
    normalizationSuccess,
    sections: sections.length,
    verified,
    degraded,
    autoPublishable,
    blocked,
    renderContractPass,
    renderContractFail: sections.length - renderContractPass,
    priceRules: sections.reduce((sum, section) => sum + section.priceRuleCount, 0),
    itineraryItems: sections.reduce((sum, section) => sum + section.itineraryItemCount, 0),
    claims: sections.reduce((sum, section) => sum + section.claimCount, 0),
    criticalClaims: sections.reduce((sum, section) => sum + section.criticalClaimCount, 0),
    missingCriticalClaims: sections.reduce((sum, section) => sum + section.missingCriticalClaimCount, 0),
    highClaims: sections.reduce((sum, section) => sum + section.highClaimCount, 0),
    missingHighClaims: sections.reduce((sum, section) => sum + section.missingHighClaimCount, 0),
    verifiedClaims: sections.reduce((sum, section) => sum + section.claimCount - section.missingCriticalClaimCount - section.missingHighClaimCount, 0),
  };
  const rate = (n: number, d: number) => d > 0 ? Number((n / d).toFixed(4)) : 0;
  const rates = {
    extractionSuccess: rate(extractionSuccess, input.documents.length),
    normalizationSuccess: rate(normalizationSuccess, input.documents.length),
    sectionVerified: rate(verified, sections.length),
    sectionDegraded: rate(degraded, sections.length),
    sectionAutoPublishable: rate(autoPublishable, sections.length),
    sectionBlocked: rate(blocked, sections.length),
    evidenceCoverage: rate(totals.verifiedClaims, totals.claims),
    renderContractPass: rate(renderContractPass, sections.length),
  };
  const status: CorpusReport['customerVerdict']['status'] = autoPublishable > 0 && blocked === 0
    ? 'customer_ready_candidate'
    : autoPublishable > 0
      ? 'limited_automated_pilot'
      : 'not_ready_for_open';
  const rationale = [
    `원문 추출 ${extractionSuccess}/${input.documents.length}건 성공`,
    `안전 자동 공개 후보 ${autoPublishable}/${sections.length}개 섹션`,
    `검증 공개 ${verified}개, 안전 축약 공개 ${degraded}개, 차단 ${blocked}개`,
    `근거 연결률 ${Math.round(rates.evidenceCoverage * 100)}%`,
    `고객 화면 계약 통과 ${renderContractPass}/${sections.length}개`,
  ];
  return {
    generatedAt: new Date().toISOString(),
    mode: 'offline-shadow-quarantine',
    publicExposure: 'none',
    sourceDirectory: input.sourceDirectory,
    totals,
    rates,
    customerVerdict: {
      status,
      summary: status === 'customer_ready_candidate'
        ? '모든 섹션이 자동 공개 후보지만, 실제 고객 오픈 전에는 운영 DB 저장·모바일 proof·관리자 승인이 남아 있습니다.'
        : status === 'limited_automated_pilot'
          ? '검증 또는 안전 축약이 가능한 상품은 자동 공개 후보로 끝나고, 구매 판단에 중요한 정보가 부족한 상품만 자동 차단됩니다.'
          : '현재 샘플은 자동 공개 가능한 상태가 아닙니다. 원문은 처리됐지만 고객 오픈 전 검수·근거·렌더 조건이 더 필요합니다.',
      rationale,
    },
    documents: input.documents,
  };
}

function markdown(report: CorpusReport): string {
  const { totals, rates, customerVerdict } = report;
  const lines: string[] = [];
  lines.push('# 상품등록 통합 자동화 엔진 전수 Shadow/Quarantine 검증 결과');
  lines.push('');
  lines.push(`- 실행 시각: ${report.generatedAt}`);
  lines.push(`- 처리 모드: 원문 기반 오프라인 격리 검증 (고객 노출 없음)`);
  lines.push(`- 원본 폴더: \`${report.sourceDirectory}\``);
  lines.push('');
  lines.push('## 고객 관점 최종 판정');
  lines.push('');
  lines.push(`**${customerVerdict.status}** — ${customerVerdict.summary}`);
  lines.push('');
  for (const item of customerVerdict.rationale) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## 전체 수치');
  lines.push('');
  lines.push('| 항목 | 결과 |');
  lines.push('|---|---:|');
  lines.push(`| 원문 파일 | ${totals.files}건 |`);
  lines.push(`| 추출 성공 | ${totals.extractionSuccess}/${totals.files} (${Math.round(rates.extractionSuccess * 100)}%) |`);
  lines.push(`| 정규화 성공 | ${totals.normalizationSuccess}/${totals.files} (${Math.round(rates.normalizationSuccess * 100)}%) |`);
  lines.push(`| 상품 섹션 | ${totals.sections}개 |`);
  lines.push(`| 안전 자동 공개 후보 | ${totals.autoPublishable}개 (${Math.round(rates.sectionAutoPublishable * 100)}%) |`);
  lines.push(`| 검증 공개 | ${totals.verified}개 (${Math.round(rates.sectionVerified * 100)}%) |`);
  lines.push(`| 안전 축약 공개 | ${totals.degraded}개 (${Math.round(rates.sectionDegraded * 100)}%) |`);
  lines.push(`| 공개 차단 | ${totals.blocked}개 (${Math.round(rates.sectionBlocked * 100)}%) |`);
  lines.push(`| 가격 규칙 | ${totals.priceRules}개 |`);
  lines.push(`| 일정 항목 | ${totals.itineraryItems}개 |`);
  lines.push(`| claim 근거 연결률 | ${Math.round(rates.evidenceCoverage * 100)}% (${totals.verifiedClaims}/${totals.claims}) |`);
  lines.push(`| 고객 화면 계약 통과 | ${totals.renderContractPass}/${totals.sections} (${Math.round(rates.renderContractPass * 100)}%) |`);
  lines.push('');
  lines.push('## 파일별 결과');
  lines.push('');
  lines.push('| 파일 | 추출 | 섹션 | 후보/검수/차단 | 가격 | 일정 | 고객 화면 | 주요 사유 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|');
  for (const document of report.documents) {
    const candidate = document.sections.filter(section => section.classification === 'verified').length;
    const review = document.sections.filter(section => section.classification === 'degraded').length;
    const blocked = document.sections.filter(section => section.classification === 'blocked').length;
    const reasons = document.sections.flatMap(section => [...section.criticalFailures, ...section.highWarnings]).slice(0, 2).join('<br>') || '-';
    lines.push(`| ${document.filename.replaceAll('|', '\\|')} | ${document.extraction.success ? '성공' : '실패'} | ${document.sections.length} | ${candidate}/${review}/${blocked} | ${document.sections.reduce((n, section) => n + section.priceRuleCount, 0)} | ${document.sections.reduce((n, section) => n + section.itineraryItemCount, 0)} | ${document.sections.filter(section => section.renderContractPass).length}/${document.sections.length} | ${reasons} |`);
  }
  lines.push('');
  lines.push('## 고객이라면 이렇게 판단합니다');
  lines.push('');
  lines.push('- 가격과 출발일이 원문 근거와 연결되고, 일정이 실제 모바일 화면에서 깨지지 않는 상품만 구매 후보로 봅니다.');
  lines.push('- 관광지 미매칭, 옵션/쇼핑 해석 불명확, 항공·호텔·취소조건 누락이 하나라도 있으면 “문의 필요” 또는 비공개가 맞습니다.');
  lines.push('- 이번 결과는 고객 공개 전 단계입니다. 이 리포트는 자동 승인·DB 공개·캐시 반영을 수행하지 않았습니다.');
  lines.push('- 다음 공개 게이트는 운영 DB shadow 저장 → 핵심 필드 diff → 동일 snapshot 모바일 proof → 정책 기준 자동 판정 → CAS atomic publication 순서입니다.');
  lines.push('');
  lines.push('## 정확도 해석');
  lines.push('');
  lines.push('이 수치는 정답 원문과 자동 추출 결과의 완전한 의미 정확도(precision/recall)가 아니라, 추출 성공·근거 연결·규칙 통과·렌더 계약 통과를 측정한 안전성 지표입니다. 실제 가격 숫자와 고객 문구의 사업적 정확도는 운영 DB shadow와 사람 검수 표본에서 최종 확정해야 합니다.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main(): Promise<void> {
  const sourceDirectory = resolve(arg('--dir', 'C:/Users/admin/Downloads/코덱스테스트'));
  const jsonOut = resolve(arg('--json-out', 'data/product-registration/v5-shadow-corpus/2026-08-10.json'));
  const reportOut = resolve(arg('--report-out', 'docs/audits/2026-08-10-product-registration-v5-shadow-corpus.md'));
  const files = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === '.hwp')
    .map(entry => join(sourceDirectory, entry.name))
    .sort((a, b) => basename(a).localeCompare(b, 'ko'));
  if (files.length === 0) throw new Error(`NO_HWP_FILES:${sourceDirectory}`);
  const documents: DocumentResult[] = [];
  for (const file of files) {
    process.stdout.write(`\r처리 중 ${documents.length + 1}/${files.length}: ${basename(file).slice(0, 52).padEnd(52)} `);
    documents.push(await processFile(file));
  }
  process.stdout.write('\n');
  const report = aggregate({ sourceDirectory, documents });
  await mkdir(join(resolve(jsonOut), '..'), { recursive: true });
  await mkdir(join(resolve(reportOut), '..'), { recursive: true });
  await writeFile(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(reportOut, markdown(report), 'utf8');
  console.log(JSON.stringify({ jsonOut, reportOut, totals: report.totals, rates: report.rates, customerVerdict: report.customerVerdict }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
