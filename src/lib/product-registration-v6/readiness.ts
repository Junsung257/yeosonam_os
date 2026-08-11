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

  if (input.config.workflowEnabled) {
    add('V6_WORKFLOW_ENABLED', 'pass', '신규 업로드가 V6 durable workflow로 전달됩니다.');
  } else {
    add('V6_WORKFLOW_DISABLED', 'blocked', 'Production workflow flag가 꺼져 있어 기존 등록 경로가 유지됩니다.');
    recommendations.push('Preview에서 실제 HWP 1건을 V6 shadow workflow로 먼저 실행하세요.');
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
    'V6_WORKFLOW_DISABLED',
    'V6_PROOF_SECRET_MISSING',
    'V6_BROWSER_PROOF_RUNTIME_MISSING',
    'V6_OCR_PROVIDERS_INCOMPLETE',
  ].includes(check.code));
  const publicationBlockers = checks.some(check => check.status === 'blocked' && [
    'V6_PUBLICATION_LOCKED',
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
