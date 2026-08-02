import { createHash } from 'node:crypto';

import { recoverCatalogSplitFromRawText } from '@/lib/product-registration/catalog-split-recovery';
import { DEFAULT_LAND_OPERATOR_COMMISSION_RATE } from '@/lib/upload-source-metadata';

export type UploadInputAuditProduct = {
  sourceFile: string;
  productIndex: number;
  rawTextHash: string;
  title: string | null;
  destination: string | null;
  blockerCategory: string | null;
  publishableOffline: boolean;
  customerReadyOffline: boolean;
  commercialMetadataReady: boolean;
  commercialMetadataIssues: string[];
  registrationReadyOffline: boolean;
  blockers: string[];
  remediation?: {
    actions?: Array<{
      field?: string;
      title?: string;
      instruction?: string;
      actionHref?: string;
      actionLabel?: string;
    }>;
  };
};

export type UploadInputAuditReport = {
  generatedAt: string;
  sourceReport: string;
  products: UploadInputAuditProduct[];
};

export type UploadInputSource = {
  sourceFile: string;
  extractedTextPath: string;
  rawText: string;
};

export type UploadOneByOneInputEntry = {
  sequence: number;
  sourceFile: string;
  productIndex: number;
  productNumberInFile: number;
  title: string | null;
  destination: string | null;
  rawTextHash: string;
  textFileName: string;
  text: string;
  sourceExtractedTextPath: string;
  publishableOffline: boolean;
  customerReadyOffline: boolean;
  commercialMetadataReady: boolean;
  registrationReadyOffline: boolean;
  blockerCategory: string | null;
  blockers: string[];
  commercialMetadataIssues: string[];
  requiredActions: string[];
};

export type UploadOneByOneInputPack = {
  version: 1;
  generatedAt: string;
  sourceAuditGeneratedAt: string;
  sourceReport: string;
  rule: {
    oneProductPerUpload: true;
    rawTextHashAlgorithm: 'sha256';
    commercialMetadataMustBeProductSpecific: true;
    guessedCommercialMetadataForbidden: true;
    defaultCommissionRatePercent: number;
  };
  summary: {
    sourceFiles: number;
    products: number;
    rawTextHashesVerified: number;
    allHashesMatch: true;
    publishableOffline: number;
    customerReadyOffline: number;
    commercialMetadataReady: number;
    registrationReadyOffline: number;
    minimumProductsFor95Percent: number;
  };
  entries: UploadOneByOneInputEntry[];
};

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function reconstructProductTexts(rawText: string): string[] {
  const recovered = recoverCatalogSplitFromRawText(rawText);
  if (recovered.length === 0) return [rawText];
  return recovered.map(product => product.sectionRawText ?? rawText);
}

function uniqueActions(product: UploadInputAuditProduct): string[] {
  const actions = [
    ...product.commercialMetadataIssues,
    ...(product.remediation?.actions ?? []).map(action => (
      [action.title, action.instruction].filter(Boolean).join(': ')
    )),
  ].filter(value => value.trim().length > 0);
  return [...new Set(actions)];
}

function assertAuditProduct(
  product: UploadInputAuditProduct,
  sourceFile: string,
  expectedIndex: number,
): void {
  if (product.productIndex !== expectedIndex) {
    throw new Error(
      `${sourceFile}: 상품 인덱스가 연속적이지 않습니다. `
      + `예상 ${expectedIndex}, 실제 ${product.productIndex}`,
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(product.rawTextHash)) {
    throw new Error(`${sourceFile} #${product.productIndex + 1}: 감사 SHA-256 형식이 잘못되었습니다.`);
  }
}

export function buildUploadOneByOneInputPack(
  audit: UploadInputAuditReport,
  sources: UploadInputSource[],
  generatedAt = new Date().toISOString(),
): UploadOneByOneInputPack {
  if (audit.products.length === 0) {
    throw new Error('감사 상품이 0건이라 입력 묶음을 만들 수 없습니다.');
  }

  const auditProductsBySource = new Map<string, UploadInputAuditProduct[]>();
  const auditProductKeys = new Set<string>();
  for (const product of audit.products) {
    const key = `${product.sourceFile}\u0000${product.productIndex}`;
    if (auditProductKeys.has(key)) {
      throw new Error(`${product.sourceFile} #${product.productIndex + 1}: 중복 감사 상품입니다.`);
    }
    auditProductKeys.add(key);
    const products = auditProductsBySource.get(product.sourceFile) ?? [];
    products.push(product);
    auditProductsBySource.set(product.sourceFile, products);
  }

  const sourceByFile = new Map<string, UploadInputSource>();
  for (const source of sources) {
    if (sourceByFile.has(source.sourceFile)) {
      throw new Error(`${source.sourceFile}: 추출 원문이 중복되었습니다.`);
    }
    sourceByFile.set(source.sourceFile, source);
  }

  const missingSources = [...auditProductsBySource.keys()].filter(sourceFile => !sourceByFile.has(sourceFile));
  if (missingSources.length > 0) {
    throw new Error(`추출 원문이 없는 감사 파일: ${missingSources.join(', ')}`);
  }
  const unauditedSources = [...sourceByFile.keys()].filter(sourceFile => !auditProductsBySource.has(sourceFile));
  if (unauditedSources.length > 0) {
    throw new Error(`상품 감사 결과가 없는 추출 파일: ${unauditedSources.join(', ')}`);
  }

  const entries: UploadOneByOneInputEntry[] = [];
  for (const source of sources) {
    const auditProducts = [...(auditProductsBySource.get(source.sourceFile) ?? [])]
      .sort((left, right) => left.productIndex - right.productIndex);
    const productTexts = reconstructProductTexts(source.rawText);
    if (productTexts.length !== auditProducts.length) {
      throw new Error(
        `${source.sourceFile}: 현재 분리 결과 ${productTexts.length}건과 `
        + `감사 결과 ${auditProducts.length}건이 다릅니다.`,
      );
    }

    auditProducts.forEach((product, productIndex) => {
      assertAuditProduct(product, source.sourceFile, productIndex);
      const text = productTexts[productIndex];
      if (text.trim().length < 50) {
        throw new Error(`${source.sourceFile} #${productIndex + 1}: 원문이 50자 미만입니다.`);
      }
      const reconstructedHash = hashText(text);
      if (reconstructedHash !== product.rawTextHash) {
        throw new Error(
          `${source.sourceFile} #${productIndex + 1}: 원문 SHA-256 불일치 `
          + `(감사 ${product.rawTextHash}, 재구성 ${reconstructedHash})`,
        );
      }

      const sequence = entries.length + 1;
      entries.push({
        sequence,
        sourceFile: source.sourceFile,
        productIndex,
        productNumberInFile: productIndex + 1,
        title: product.title,
        destination: product.destination,
        rawTextHash: reconstructedHash,
        textFileName: `${String(sequence).padStart(3, '0')}-${reconstructedHash.slice(0, 12)}.txt`,
        text,
        sourceExtractedTextPath: source.extractedTextPath,
        publishableOffline: product.publishableOffline,
        customerReadyOffline: product.customerReadyOffline,
        commercialMetadataReady: product.commercialMetadataReady,
        registrationReadyOffline: product.registrationReadyOffline,
        blockerCategory: product.blockerCategory,
        blockers: [...product.blockers],
        commercialMetadataIssues: [...product.commercialMetadataIssues],
        requiredActions: uniqueActions(product),
      });
    });
  }

  return {
    version: 1,
    generatedAt,
    sourceAuditGeneratedAt: audit.generatedAt,
    sourceReport: audit.sourceReport,
    rule: {
      oneProductPerUpload: true,
      rawTextHashAlgorithm: 'sha256',
      commercialMetadataMustBeProductSpecific: true,
      guessedCommercialMetadataForbidden: true,
      defaultCommissionRatePercent: DEFAULT_LAND_OPERATOR_COMMISSION_RATE,
    },
    summary: {
      sourceFiles: sources.length,
      products: entries.length,
      rawTextHashesVerified: entries.length,
      allHashesMatch: true,
      publishableOffline: entries.filter(entry => entry.publishableOffline).length,
      customerReadyOffline: entries.filter(entry => entry.customerReadyOffline).length,
      commercialMetadataReady: entries.filter(entry => entry.commercialMetadataReady).length,
      registrationReadyOffline: entries.filter(entry => entry.registrationReadyOffline).length,
      minimumProductsFor95Percent: Math.ceil(entries.length * 0.95),
    },
    entries,
  };
}

function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildUploadOneByOneInputCsv(pack: UploadOneByOneInputPack): string {
  const headers = [
    '순번',
    '원본 HWP',
    '파일 내 상품 번호',
    '상품명',
    '목적지',
    '입력 TXT',
    'SHA-256',
    '콘텐츠 조건부 준비',
    '랜드사명(필수 입력)',
    `커미션율 %(비우면 기본 ${DEFAULT_LAND_OPERATOR_COMMISSION_RATE}%)`,
    '엄격 등록 준비',
    '차단 분류',
    '필요 조치',
  ];
  const rows = pack.entries.map(entry => [
    entry.sequence,
    entry.sourceFile,
    entry.productNumberInFile,
    entry.title,
    entry.destination,
    entry.textFileName,
    entry.rawTextHash,
    entry.customerReadyOffline,
    '',
    '',
    entry.registrationReadyOffline,
    entry.blockerCategory,
    entry.requiredActions.join(' | '),
  ]);
  return [
    headers.map(csvCell).join(','),
    ...rows.map(row => row.map(csvCell).join(',')),
    '',
  ].join('\n');
}

export function buildUploadOneByOneInputMarkdown(pack: UploadOneByOneInputPack): string {
  return [
    '# HWP 상품 1건씩 등록 입력 묶음',
    '',
    `- 원본 HWP: ${pack.summary.sourceFiles}개`,
    `- 분리된 상품: ${pack.summary.products}개`,
    `- 기존 감사 SHA-256 일치: ${pack.summary.rawTextHashesVerified}/${pack.summary.products}`,
    `- 콘텐츠 조건부 준비: ${pack.summary.customerReadyOffline}/${pack.summary.products}`,
    `- 상품별 랜드사·커미션 준비: ${pack.summary.commercialMetadataReady}/${pack.summary.products}`,
    `- 엄격 등록 준비: ${pack.summary.registrationReadyOffline}/${pack.summary.products}`,
    `- 95% 달성 최소 상품 수: ${pack.summary.minimumProductsFor95Percent}개`,
    '',
    '## 사용 규칙',
    '',
    '1. `texts` 폴더의 TXT 하나만 열어 `/admin/upload` 상품 텍스트에 그대로 붙여넣습니다.',
    `2. 같은 행의 실제 랜드사명을 입력합니다. 커미션율을 비워두면 ${DEFAULT_LAND_OPERATOR_COMMISSION_RATE}%가 자동 입력되며, 실제 계약과 다르면 저장 전에 수정합니다.`,
    '3. 한 번에 TXT 두 개 이상을 합치지 않습니다.',
    '4. 랜드사는 파일명이나 관행으로 추정하지 않습니다. 기본 커미션은 정산 근거가 아니므로 실제 계약을 확인합니다.',
    '5. 저장 후 고객 모바일 미리보기와 공개 게이트를 통과한 상품만 공개합니다.',
    '',
    '상품별 입력 순서와 조치 사항은 `upload-one-by-one-input-manifest.csv`에서 확인합니다.',
    '',
  ].join('\n');
}
