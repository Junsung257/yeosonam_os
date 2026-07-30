import type { AttractionOwnerReviewPack } from '@/lib/attraction-owner-review-pack';

export type UploadChecklistSourceProduct = {
  sourceFile: string;
  productIndex: number;
  rawTextHash: string;
  title: string | null;
  destination: string | null;
  destinationCode: string | null;
  priceRows: number;
  priceDates: number;
  itineraryDays: number;
  customerReadyOffline: boolean;
  remediation: {
    ready: boolean;
    actions: Array<{
      kind: string;
      field: string;
      title: string;
      instruction: string;
      sourcePhrases: string[];
    }>;
    supplierRequestText: string | null;
  };
};

export type UploadChecklistSourceReport = {
  generatedAt?: string;
  products: UploadChecklistSourceProduct[];
};

export type UploadChecklistPhase =
  | 'ready_for_admin_upload'
  | 'supplier_confirmation_then_reaudit'
  | 'owner_review_then_reaudit'
  | 'owner_and_supplier_then_reaudit'
  | 'attraction_identity_hold'
  | 'attraction_and_supplier_hold'
  | 'system_repair_then_reaudit';

export type UploadBatchChecklistRow = {
  sequence: number;
  productKey: string;
  phase: UploadChecklistPhase;
  phaseLabel: string;
  sourceFile: string;
  productNumberInFile: number;
  rawTextHash: string;
  title: string;
  destination: string;
  destinationCode: string;
  priceRows: number;
  priceDates: number;
  itineraryDays: number;
  readyForAdminUpload: boolean;
  customerOpenAllowed: false;
  requiredActions: string[];
  sourcePhrases: string[];
  supplierRequestText: string | null;
  postUploadProofRequired: string[];
};

export type UploadBatchOperatorChecklist = {
  version: 1;
  generatedAt: string;
  sourceAuditGeneratedAt?: string;
  summary: {
    products: number;
    readyForAdminUpload: number;
    customerOpenAllowedWithoutFreshProof: 0;
    supplierConfirmation: number;
    ownerReviewCandidateOnly: number;
    ownerAndSupplier: number;
    attractionIdentityHold: number;
    attractionAndSupplierHold: number;
    systemRepair: number;
    minimumProductsFor95Percent: number;
    currentOfflineReadyRate: number;
  };
  operatingRule: string;
  rows: UploadBatchChecklistRow[];
};

const PHASE_ORDER: Record<UploadChecklistPhase, number> = {
  ready_for_admin_upload: 1,
  supplier_confirmation_then_reaudit: 2,
  owner_review_then_reaudit: 3,
  owner_and_supplier_then_reaudit: 4,
  attraction_identity_hold: 5,
  attraction_and_supplier_hold: 6,
  system_repair_then_reaudit: 7,
};

const PHASE_LABELS: Record<UploadChecklistPhase, string> = {
  ready_for_admin_upload: '1차 업로드 검증 대상',
  supplier_confirmation_then_reaudit: '랜드사 확정값 수신 후 재감사',
  owner_review_then_reaudit: '관광지 사장님 승인 후 재감사',
  owner_and_supplier_then_reaudit: '관광지 승인 + 랜드사 확정 후 재감사',
  attraction_identity_hold: '관광지 공식명 확인 전 보류',
  attraction_and_supplier_hold: '관광지 공식명 + 랜드사 확정 전 보류',
  system_repair_then_reaudit: '시스템 수정 후 재감사',
};

const POST_UPLOAD_PROOF = [
  '원문 해시와 저장된 source evidence 일치',
  '판매가 행과 출발일 양방향 일치',
  '일정 일수·박수·항공·호텔 최종 저장값 일치',
  '/packages/{id} 모바일 브라우저 증명',
  '/lp/{id} 모바일 브라우저 증명 및 CTA 열림',
  '고객 금지문구·깨진 문구·내부 정산정보 0건',
] as const;

function productKey(sourceFile: string, productIndex: number): string {
  return `${sourceFile}#${productIndex}`;
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

function phaseForProduct(
  product: UploadChecklistSourceProduct,
  attractionDecision: 'identity_resolvable' | 'held' | null,
): UploadChecklistPhase {
  if (product.customerReadyOffline && product.remediation.ready) {
    return 'ready_for_admin_upload';
  }

  const hasAttraction = product.remediation.actions.some(action => action.kind === 'attraction_review');
  const hasSupplier = product.remediation.actions.some(action => action.kind === 'supplier_confirmation');
  const hasSystem = product.remediation.actions.some(action => action.kind === 'system_repair');

  if (hasAttraction && attractionDecision === 'held') {
    return hasSupplier ? 'attraction_and_supplier_hold' : 'attraction_identity_hold';
  }
  if (hasAttraction && attractionDecision === 'identity_resolvable') {
    return hasSupplier ? 'owner_and_supplier_then_reaudit' : 'owner_review_then_reaudit';
  }
  if (hasSupplier) return 'supplier_confirmation_then_reaudit';
  if (hasSystem) return 'system_repair_then_reaudit';
  return 'system_repair_then_reaudit';
}

function validateChecklistInputs(
  report: UploadChecklistSourceReport,
  attractionPack: AttractionOwnerReviewPack,
): void {
  const errors: string[] = [];
  const seen = new Set<string>();
  const attractionImpact = new Set(
    attractionPack.productImpact.map(item => productKey(item.sourceFile, item.productIndex)),
  );

  for (const product of report.products) {
    const key = productKey(product.sourceFile, product.productIndex);
    if (seen.has(key)) errors.push(`중복 상품 키: ${key}`);
    seen.add(key);

    if (!product.title?.trim()) errors.push(`상품명이 없습니다: ${key}`);
    if (!product.rawTextHash?.trim()) errors.push(`원문 해시가 없습니다: ${key}`);
    if (product.customerReadyOffline !== product.remediation.ready) {
      errors.push(`오프라인 준비 상태와 운영 조치 상태가 다릅니다: ${key}`);
    }
    if (!product.customerReadyOffline && product.remediation.actions.length === 0) {
      errors.push(`보류 상품에 운영 조치가 없습니다: ${key}`);
    }
    if (product.customerReadyOffline && product.remediation.actions.length > 0) {
      errors.push(`준비 상품에 보류 조치가 남아 있습니다: ${key}`);
    }
    const hasAttraction = product.remediation.actions.some(action => action.kind === 'attraction_review');
    if (hasAttraction && !attractionImpact.has(key)) {
      errors.push(`관광지 검수팩에 상품이 없습니다: ${key}`);
    }
  }

  for (const key of attractionImpact) {
    if (!seen.has(key)) errors.push(`현재 감사에 없는 관광지 검수 상품입니다: ${key}`);
  }

  if (errors.length > 0) {
    throw new Error(`한 건씩 업로드 체크리스트 생성 실패:\n- ${errors.join('\n- ')}`);
  }
}

export function buildUploadBatchOperatorChecklist(
  report: UploadChecklistSourceReport,
  attractionPack: AttractionOwnerReviewPack,
  generatedAt = new Date().toISOString(),
): UploadBatchOperatorChecklist {
  validateChecklistInputs(report, attractionPack);
  const attractionByProduct = new Map(
    attractionPack.productImpact.map(item => [
      productKey(item.sourceFile, item.productIndex),
      item.decision,
    ]),
  );

  const rowsWithoutSequence = report.products.map(product => {
    const key = productKey(product.sourceFile, product.productIndex);
    const phase = phaseForProduct(product, attractionByProduct.get(key) ?? null);
    const requiredActions = product.customerReadyOffline
      ? [
          'admin/upload에서 원문 1건 등록',
          '저장 결과와 원문 가격·출발일·일정 대조',
          '두 고객 화면의 새 브라우저 증명 생성',
          '모든 공개 게이트 통과 후에만 승인',
        ]
      : product.remediation.actions.map(action => `${action.title}: ${action.instruction}`);

    return {
      productKey: key,
      phase,
      phaseLabel: PHASE_LABELS[phase],
      sourceFile: product.sourceFile,
      productNumberInFile: product.productIndex + 1,
      rawTextHash: product.rawTextHash,
      title: product.title?.trim() ?? '',
      destination: product.destination?.trim() ?? '',
      destinationCode: product.destinationCode?.trim() ?? '',
      priceRows: product.priceRows,
      priceDates: product.priceDates,
      itineraryDays: product.itineraryDays,
      readyForAdminUpload: phase === 'ready_for_admin_upload',
      customerOpenAllowed: false as const,
      requiredActions,
      sourcePhrases: [...new Set(
        product.remediation.actions.flatMap(action => action.sourcePhrases),
      )],
      supplierRequestText: product.remediation.supplierRequestText,
      postUploadProofRequired: [...POST_UPLOAD_PROOF],
    };
  });

  rowsWithoutSequence.sort((left, right) =>
    PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase]
    || left.sourceFile.localeCompare(right.sourceFile, 'ko')
    || left.productNumberInFile - right.productNumberInFile,
  );
  const rows = rowsWithoutSequence.map((row, index) => ({ sequence: index + 1, ...row }));
  const products = rows.length;
  const readyForAdminUpload = rows.filter(row => row.phase === 'ready_for_admin_upload').length;

  return {
    version: 1,
    generatedAt,
    sourceAuditGeneratedAt: report.generatedAt,
    summary: {
      products,
      readyForAdminUpload,
      customerOpenAllowedWithoutFreshProof: 0,
      supplierConfirmation: rows.filter(
        row => row.phase === 'supplier_confirmation_then_reaudit',
      ).length,
      ownerReviewCandidateOnly: rows.filter(
        row => row.phase === 'owner_review_then_reaudit',
      ).length,
      ownerAndSupplier: rows.filter(
        row => row.phase === 'owner_and_supplier_then_reaudit',
      ).length,
      attractionIdentityHold: rows.filter(
        row => row.phase === 'attraction_identity_hold',
      ).length,
      attractionAndSupplierHold: rows.filter(
        row => row.phase === 'attraction_and_supplier_hold',
      ).length,
      systemRepair: rows.filter(
        row => row.phase === 'system_repair_then_reaudit',
      ).length,
      minimumProductsFor95Percent: Math.ceil(products * 0.95),
      currentOfflineReadyRate: percent(readyForAdminUpload, products),
    },
    operatingRule:
      '오프라인 준비는 admin/upload 검증 시작 자격일 뿐 고객 공개 승인이 아닙니다. '
      + '실제 저장 후 /packages와 /lp 새 브라우저 증명을 모두 통과해야 공개할 수 있습니다.',
    rows,
  };
}

function escapeCsv(value: unknown): string {
  const text = Array.isArray(value) ? value.join('\n') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildUploadBatchOperatorChecklistCsv(
  checklist: UploadBatchOperatorChecklist,
): string {
  const headers = [
    '순번',
    '상태',
    '원본파일',
    '파일내상품번호',
    '상품명',
    '목적지',
    '목적지코드',
    '가격행수',
    '출발일수',
    '일정일수',
    'admin_upload_시작가능',
    '현재_고객공개가능',
    '다음조치',
    '확인필요_원문문구',
    '랜드사요청문',
    '원문해시',
  ];
  const rows = checklist.rows.map(row => [
    row.sequence,
    row.phaseLabel,
    row.sourceFile,
    row.productNumberInFile,
    row.title,
    row.destination,
    row.destinationCode,
    row.priceRows,
    row.priceDates,
    row.itineraryDays,
    row.readyForAdminUpload ? '예' : '아니오',
    '아니오',
    row.requiredActions,
    row.sourcePhrases,
    row.supplierRequestText ?? '',
    row.rawTextHash,
  ].map(escapeCsv).join(','));
  return `\uFEFF${headers.join(',')}\n${rows.join('\n')}\n`;
}

export function buildUploadBatchOperatorChecklistMarkdown(
  checklist: UploadBatchOperatorChecklist,
): string {
  const summary = checklist.summary;
  const lines = [
    '# HWP 71개 상품 한 건씩 업로드 체크리스트',
    '',
    `생성 시각: ${checklist.generatedAt}`,
    `원본 감사 시각: ${checklist.sourceAuditGeneratedAt ?? '미기록'}`,
    '',
    '- 이 문서는 DB 등록 목록이 아니라 운영 순서표입니다.',
    '- 모든 행의 현재 고객 공개 가능 값은 `아니오`입니다.',
    '- 1차 업로드 검증 대상도 실제 저장 후 `/packages`와 `/lp` 새 브라우저 증명이 있어야 공개할 수 있습니다.',
    '',
    '## 요약',
    '',
    `- 전체 상품: ${summary.products}`,
    `- 1차 admin/upload 검증 대상: ${summary.readyForAdminUpload}`,
    `- 랜드사 확정값 수신 후 재감사: ${summary.supplierConfirmation}`,
    `- 관광지 사장님 승인 후 재감사: ${summary.ownerReviewCandidateOnly}`,
    `- 관광지 승인 + 랜드사 확정 후 재감사: ${summary.ownerAndSupplier}`,
    `- 관광지 공식명 확인 전 보류: ${summary.attractionIdentityHold}`,
    `- 관광지 공식명 + 랜드사 확정 전 보류: ${summary.attractionAndSupplierHold}`,
    `- 시스템 수정 후 재감사: ${summary.systemRepair}`,
    `- 95% 기준 최소 상품 수: ${summary.minimumProductsFor95Percent}`,
    '',
    '## 1차 admin/upload 검증 대상',
    '',
    '| 순번 | 원본 파일 | 파일 내 상품 | 상품명 | 목적지 | 가격행/출발일/일정 |',
    '|---:|---|---:|---|---|---:|',
    ...checklist.rows
      .filter(row => row.readyForAdminUpload)
      .map(row =>
        `| ${row.sequence} | ${row.sourceFile} | ${row.productNumberInFile} | `
        + `${row.title} | ${row.destination || '-'} | `
        + `${row.priceRows}/${row.priceDates}/${row.itineraryDays} |`,
      ),
    '',
    '## 보류·재감사 대상',
    '',
    '| 순번 | 상태 | 원본 파일 | 파일 내 상품 | 상품명 | 다음 조치 |',
    '|---:|---|---|---:|---|---|',
    ...checklist.rows
      .filter(row => !row.readyForAdminUpload)
      .map(row =>
        `| ${row.sequence} | ${row.phaseLabel} | ${row.sourceFile} | `
        + `${row.productNumberInFile} | ${row.title} | `
        + `${row.requiredActions.join('<br>')} |`,
      ),
    '',
    '## 실제 등록 후 공통 공개 증명',
    '',
    ...POST_UPLOAD_PROOF.map(item => `- ${item}`),
    '',
  ];
  return lines.join('\n');
}
