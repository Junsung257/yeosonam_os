import type { ProductRegistrationV6RuntimeConfig } from './runtime-config';

export type ProductRegistrationV6ReadinessStatus = 'pass' | 'warning' | 'blocked';

export type ProductRegistrationV6ReadinessCheck = {
  code: string;
  status: ProductRegistrationV6ReadinessStatus;
  detail: string;
};

export type ProductRegistrationV6ReadinessReport = {
  generatedAt: string;
  readyForCanary: boolean;
  readyForPublication: boolean;
  readyForFullCohort: boolean;
  checks: ProductRegistrationV6ReadinessCheck[];
  recommendations: string[];
  database: {
    v6ColumnAvailable: boolean;
    authorityMode: 'legacy' | 'shadow' | 'kernel' | null;
    publicationFrozen: boolean | null;
    schemaVersion: string | null;
    schemaVerificationState: string | null;
    unvalidatedTenantForeignKeys: number | null;
    legacyPublicationRpcsExecutable: boolean | null;
    publishedPointerCount: number | null;
    passedProofCount: number | null;
    unfinishedJobCount: number | null;
  };
};

export type ProductRegistrationV6ReadinessInput = {
  config: ProductRegistrationV6RuntimeConfig;
  credentials: {
    proofSecret: boolean;
    browser: boolean;
    oag: boolean;
    cirium: boolean;
    clova: boolean;
    googleDocumentAi: boolean;
    ocrEnabled: boolean;
  };
  database: ProductRegistrationV6ReadinessReport['database'];
  generatedAt?: string;
};

export function buildProductRegistrationV6ReadinessReport(
  input: ProductRegistrationV6ReadinessInput,
): ProductRegistrationV6ReadinessReport {
  const checks: ProductRegistrationV6ReadinessCheck[] = [];
  const recommendations: string[] = [];
  const add = (code: string, status: ProductRegistrationV6ReadinessStatus, detail: string) => {
    checks.push({ code, status, detail });
  };

  if (input.database.v6ColumnAvailable) {
    add('V6_SCHEMA_REACHABLE', 'pass', 'upload_jobs의 V6 상태 컬럼을 확인했습니다.');
  } else {
    add('V6_SCHEMA_UNAVAILABLE', 'blocked', '운영 DB에서 V6 상태 컬럼을 확인하지 못했습니다.');
  }

  const authorityModeMatches = input.database.authorityMode === input.config.authorityMode;
  if (authorityModeMatches) {
    add('V6_AUTHORITY_MODE_PARITY', 'pass', `환경과 DB authority mode가 ${input.config.authorityMode}로 일치합니다.`);
  } else {
    add('V6_AUTHORITY_MODE_MISMATCH', 'blocked', `환경(${input.config.authorityMode})과 DB(${input.database.authorityMode ?? 'unknown'}) authority mode가 다릅니다.`);
    recommendations.push('환경변수와 DB authority mode를 같은 배포 단계로 맞추기 전에는 workflow와 공개를 시작하지 마세요.');
  }

  if (input.database.publicationFrozen === input.config.publicationFrozen) {
    add('V6_PUBLICATION_FREEZE_PARITY', 'pass', '환경과 DB publication freeze 값이 일치합니다.');
  } else {
    add('V6_PUBLICATION_FREEZE_MISMATCH', 'blocked', `환경(${input.config.publicationFrozen})과 DB(${String(input.database.publicationFrozen)}) publication freeze 값이 다릅니다.`);
  }

  if (input.database.schemaVerificationState === 'verified'
    && input.database.unvalidatedTenantForeignKeys === 0) {
    add('V6_SCHEMA_MANIFEST_VERIFIED', 'pass', `${input.database.schemaVersion ?? 'unknown'} schema와 tenant FK가 검증되었습니다.`);
  } else {
    add('V6_SCHEMA_MANIFEST_UNVERIFIED', 'blocked', `schema=${input.database.schemaVersion ?? 'unknown'}, state=${input.database.schemaVerificationState ?? 'missing'}, unvalidatedFK=${String(input.database.unvalidatedTenantForeignKeys)}`);
  }

  if (input.database.legacyPublicationRpcsExecutable === false) {
    add('V6_LEGACY_PUBLICATION_RPC_RETIRED', 'pass', '구형 공개 RPC의 service-role 실행권한이 회수되었습니다.');
  } else {
    add('V6_LEGACY_PUBLICATION_RPC_EXECUTABLE', 'blocked', '구형 공개 RPC가 아직 실행 가능하거나 권한 상태를 확인할 수 없습니다.');
  }

  if (input.config.workflowEnabled) {
    add('V6_WORKFLOW_ENABLED', 'pass', '신규 업로드가 V6 durable workflow로 전달됩니다.');
  } else {
    add('V6_WORKFLOW_DISABLED', 'blocked', 'Production workflow flag가 꺼져 있어 기존 등록 경로가 유지됩니다.');
    recommendations.push('Preview에서 실제 HWP 1건을 V6 shadow workflow로 먼저 실행하세요.');
  }

  if (input.config.authorityMode === 'kernel') {
    add('V6_AUTHORITY_KERNEL', 'pass', '상품 사실 writer와 공개 권한이 Registration Kernel로 고정되어 있습니다.');
  } else {
    add('V6_AUTHORITY_NOT_KERNEL', 'blocked', `${input.config.authorityMode} 모드에서는 고객 자동 공개를 허용하지 않습니다.`);
    recommendations.push('shadow 검증 기준을 충족한 뒤 DB와 환경의 authority mode를 함께 kernel로 전환하세요.');
  }

  if (input.config.shadowEnabled) {
    add('V6_SHADOW_ENABLED', 'pass', 'revision·검증·snapshot 그림자 생성이 허용됩니다.');
  } else {
    add('V6_SHADOW_DISABLED', 'warning', 'shadow 결과를 저장하지 않아 canary 비교가 불가능합니다.');
  }

  if (input.config.publicationFrozen || !input.config.publishEnabled) {
    add('V6_PUBLICATION_LOCKED', 'blocked', input.config.publicationFrozen
      ? 'publication freeze가 켜져 있습니다.'
      : '자동 CAS 공개 flag가 꺼져 있습니다.');
    recommendations.push('실제 Chrome proof와 canary 결과 확인 전에는 publication freeze를 유지하세요.');
  } else {
    add('V6_PUBLICATION_UNLOCKED', 'pass', '환경변수 수준의 공개 차단은 해제되어 있습니다.');
  }

  if (input.credentials.proofSecret) {
    add('V6_PROOF_SECRET_PRESENT', 'pass', 'proof 서명키가 설정되어 있습니다.');
  } else {
    add('V6_PROOF_SECRET_MISSING', 'blocked', 'proof URL 서명키가 없습니다.');
  }

  if (input.credentials.browser) {
    add('V6_BROWSER_PROOF_RUNTIME_PRESENT', 'pass', 'Chrome/CDP proof 실행 경로가 설정되어 있습니다.');
  } else {
    add('V6_BROWSER_PROOF_RUNTIME_MISSING', 'blocked', '운영 Chrome executable 또는 CDP endpoint가 없습니다.');
    recommendations.push('Vercel Workflow worker에서 접근 가능한 전용 Chrome/CDP endpoint를 연결하세요.');
  }

  if (input.credentials.oag && input.credentials.cirium) {
    add('V6_TRANSPORT_PROVIDERS_READY', 'pass', 'OAG·Cirium 독립 항공 일정 검증 설정이 있습니다.');
  } else {
    add('V6_TRANSPORT_PROVIDERS_INCOMPLETE', 'warning', 'OAG·Cirium 중 하나 이상이 없어 항공시간 누락 상품은 제한됩니다.');
    recommendations.push('항공시간이 원문에 없는 상품을 자동 보완하려면 OAG와 Cirium을 모두 연결하세요.');
  }

  if (!input.credentials.ocrEnabled) {
    add('V6_OCR_DISABLED', 'pass', 'OCR은 비활성화되어 스캔 문서를 자동 공개하지 않습니다.');
  } else if (input.credentials.clova && input.credentials.googleDocumentAi) {
    add('V6_OCR_PROVIDERS_READY', 'pass', 'CLOVA·Google Document AI 교차검증 설정이 있습니다.');
  } else {
    add('V6_OCR_PROVIDERS_INCOMPLETE', 'blocked', 'OCR이 켜졌지만 CLOVA·Google 교차검증 설정이 완성되지 않았습니다.');
    recommendations.push('OCR critical field는 두 provider가 일치할 때만 공개하도록 provider 설정을 완성하세요.');
  }

  const canaryBlockers = checks.some(check => check.status === 'blocked' && [
    'V6_SCHEMA_UNAVAILABLE',
    'V6_AUTHORITY_MODE_MISMATCH',
    'V6_SCHEMA_MANIFEST_UNVERIFIED',
    'V6_LEGACY_PUBLICATION_RPC_EXECUTABLE',
    'V6_WORKFLOW_DISABLED',
    'V6_PROOF_SECRET_MISSING',
    'V6_BROWSER_PROOF_RUNTIME_MISSING',
    'V6_OCR_PROVIDERS_INCOMPLETE',
  ].includes(check.code));
  const publicationBlockers = checks.some(check => check.status === 'blocked' && [
    'V6_PUBLICATION_LOCKED',
    'V6_PUBLICATION_FREEZE_MISMATCH',
    'V6_AUTHORITY_MODE_MISMATCH',
    'V6_SCHEMA_MANIFEST_UNVERIFIED',
    'V6_LEGACY_PUBLICATION_RPC_EXECUTABLE',
    'V6_AUTHORITY_NOT_KERNEL',
    'V6_SCHEMA_UNAVAILABLE',
    'V6_PROOF_SECRET_MISSING',
    'V6_BROWSER_PROOF_RUNTIME_MISSING',
    'V6_OCR_PROVIDERS_INCOMPLETE',
  ].includes(check.code));
  const fullCohortBlockers = publicationBlockers || !input.credentials.oag || !input.credentials.cirium;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    readyForCanary: !canaryBlockers,
    readyForPublication: !publicationBlockers,
    readyForFullCohort: !fullCohortBlockers,
    checks,
    recommendations: [...new Set(recommendations)],
    database: input.database,
  };
}
