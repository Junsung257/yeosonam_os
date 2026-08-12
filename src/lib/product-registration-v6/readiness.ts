import type { ProductRegistrationV6RuntimeConfig } from './runtime-config';

export type ProductRegistrationV6ReadinessStatus = 'pass' | 'warning' | 'blocked';

export type ProductRegistrationV6ReadinessCheck = {
  code: string;
  status: ProductRegistrationV6ReadinessStatus;
  detail: string;
};

export type ProductRegistrationV6ReadinessDatabase = {
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
  staleUnfinishedJobCount: number | null;
  uniqueSourceCount: number | null;
  terminalOutcomeCount: number | null;
  legacyInventoryCount: number | null;
  legacyBackfillTotalCount: number | null;
  legacyBackfillTerminalCount: number | null;
  legacyBackfillFailedCount: number | null;
  mediaReadyRevisionCount: number | null;
  benchmarkPassedCount: number | null;
  benchmarkExactMatchRate: number | null;
  benchmarkCriticalFalsePublishCount: number | null;
  cohortSampleCount: number | null;
  cohortCriticalDefectCount: number | null;
  eligibleCohortCount: number | null;
};

export type ProductRegistrationV6ReadinessReport = {
  generatedAt: string;
  readyForCanary: boolean;
  readyForPublication: boolean;
  readyForFullCohort: boolean;
  checks: ProductRegistrationV6ReadinessCheck[];
  recommendations: string[];
  database: ProductRegistrationV6ReadinessDatabase;
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
    mediaProvider: boolean;
  };
  database: ProductRegistrationV6ReadinessDatabase;
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

  add(
    input.database.v6ColumnAvailable ? 'V6_SCHEMA_REACHABLE' : 'V6_SCHEMA_UNAVAILABLE',
    input.database.v6ColumnAvailable ? 'pass' : 'blocked',
    input.database.v6ColumnAvailable ? '운영 DB의 자동화 상태 필드를 확인했습니다.' : '운영 DB의 자동화 상태 필드를 확인할 수 없습니다.',
  );

  const authorityParity = input.database.authorityMode === input.config.authorityMode;
  add(
    authorityParity ? 'V6_AUTHORITY_MODE_PARITY' : 'V6_AUTHORITY_MODE_MISMATCH',
    authorityParity ? 'pass' : 'blocked',
    authorityParity
      ? `환경과 DB의 권위 모드가 ${input.config.authorityMode}로 일치합니다.`
      : `환경(${input.config.authorityMode})과 DB(${input.database.authorityMode ?? 'unknown'}) 권위 모드가 다릅니다.`,
  );
  if (!authorityParity) recommendations.push('환경과 DB의 권위 모드를 같은 배포 단계로 맞춰야 합니다.');

  const freezeParity = input.database.publicationFrozen === input.config.publicationFrozen;
  add(
    freezeParity ? 'V6_PUBLICATION_FREEZE_PARITY' : 'V6_PUBLICATION_FREEZE_MISMATCH',
    freezeParity ? 'pass' : 'blocked',
    freezeParity ? '환경과 DB의 고객 공개 동결 값이 일치합니다.' : '환경과 DB의 고객 공개 동결 값이 다릅니다.',
  );

  const schemaVerified = input.database.schemaVerificationState === 'verified'
    && input.database.unvalidatedTenantForeignKeys === 0;
  add(
    schemaVerified ? 'V6_SCHEMA_MANIFEST_VERIFIED' : 'V6_SCHEMA_MANIFEST_UNVERIFIED',
    schemaVerified ? 'pass' : 'blocked',
    schemaVerified
      ? `${input.database.schemaVersion ?? 'unknown'} 스키마와 테넌트 연결이 검증됐습니다.`
      : `schema=${input.database.schemaVersion ?? 'unknown'}, state=${input.database.schemaVerificationState ?? 'missing'}, 미검증 FK=${String(input.database.unvalidatedTenantForeignKeys)}`,
  );

  add(
    input.database.legacyPublicationRpcsExecutable === false
      ? 'V6_LEGACY_PUBLICATION_RPC_RETIRED'
      : 'V6_LEGACY_PUBLICATION_RPC_EXECUTABLE',
    input.database.legacyPublicationRpcsExecutable === false ? 'pass' : 'blocked',
    input.database.legacyPublicationRpcsExecutable === false
      ? '구형 우회 공개 RPC의 실행 권한이 회수됐습니다.'
      : '구형 우회 공개 RPC가 실행 가능하거나 상태를 확인할 수 없습니다.',
  );

  add(
    input.config.workflowEnabled ? 'V6_WORKFLOW_ENABLED' : 'V6_WORKFLOW_DISABLED',
    input.config.workflowEnabled ? 'pass' : 'blocked',
    input.config.workflowEnabled ? '모든 신규 입력이 단일 durable workflow로 들어갑니다.' : '단일 자동화 workflow가 꺼져 있습니다.',
  );
  add(
    input.config.authorityMode === 'kernel' ? 'V6_AUTHORITY_KERNEL' : 'V6_AUTHORITY_NOT_KERNEL',
    input.config.authorityMode === 'kernel' ? 'pass' : 'blocked',
    input.config.authorityMode === 'kernel'
      ? '상품 사실을 쓰는 권한이 Registration Kernel로 고정됐습니다.'
      : `${input.config.authorityMode} 모드에서는 전면 고객 자동 공개를 허용하지 않습니다.`,
  );
  add(
    input.config.shadowEnabled ? 'V6_SHADOW_ENABLED' : 'V6_SHADOW_DISABLED',
    input.config.shadowEnabled ? 'pass' : 'warning',
    input.config.shadowEnabled ? '공개 전 비교용 revision·snapshot을 보존합니다.' : '그림자 비교 결과를 보존하지 않습니다.',
  );

  const publicationUnlocked = !input.config.publicationFrozen && input.config.publishEnabled;
  add(
    publicationUnlocked ? 'V6_PUBLICATION_UNLOCKED' : 'V6_PUBLICATION_LOCKED',
    publicationUnlocked ? 'pass' : 'blocked',
    publicationUnlocked ? 'CAS 고객 공개가 허용된 상태입니다.' : '고객 공개는 안전하게 동결돼 있습니다.',
  );

  add(
    input.credentials.proofSecret ? 'V6_PROOF_SECRET_PRESENT' : 'V6_PROOF_SECRET_MISSING',
    input.credentials.proofSecret ? 'pass' : 'blocked',
    input.credentials.proofSecret ? '비공개 proof URL 서명키가 있습니다.' : '비공개 proof URL 서명키가 없습니다.',
  );
  add(
    input.credentials.browser ? 'V6_BROWSER_PROOF_RUNTIME_PRESENT' : 'V6_BROWSER_PROOF_RUNTIME_MISSING',
    input.credentials.browser ? 'pass' : 'blocked',
    input.credentials.browser ? '실제 Chrome 모바일 proof를 실행할 수 있습니다.' : '실제 Chrome 모바일 proof 실행 경로가 없습니다.',
  );

  const staleJobs = input.database.staleUnfinishedJobCount;
  add(
    staleJobs === 0 ? 'V6_NO_STALE_JOBS' : 'V6_STALE_JOBS_PRESENT',
    staleJobs === 0 ? 'pass' : 'blocked',
    staleJobs === 0 ? '30분 넘게 멈춘 작업이 없습니다.' : `30분 넘게 멈춘 작업이 ${staleJobs ?? '확인 불가'}건 있습니다.`,
  );

  const benchmarkPassed = (input.database.benchmarkPassedCount ?? 0) > 0
    && (input.database.benchmarkExactMatchRate ?? 0) >= 0.995
    && input.database.benchmarkCriticalFalsePublishCount === 0;
  add(
    benchmarkPassed ? 'V6_CORPUS_BENCHMARK_PASSED' : 'V6_CORPUS_BENCHMARK_NOT_PASSED',
    benchmarkPassed ? 'pass' : 'blocked',
    benchmarkPassed
      ? `고정 표본 정확도 ${((input.database.benchmarkExactMatchRate ?? 0) * 100).toFixed(2)}%, 치명적 오공개 0건입니다.`
      : '고정 표본의 99.5% exact match·치명적 오공개 0건 기준이 아직 DB에 증명되지 않았습니다.',
  );

  const inventory = input.database.legacyInventoryCount ?? 0;
  const backfillTerminal = input.database.legacyBackfillTerminalCount ?? 0;
  const backfillComplete = inventory > 0 && backfillTerminal >= inventory;
  add(
    backfillComplete ? 'V6_LEGACY_BACKFILL_COMPLETE' : 'V6_LEGACY_BACKFILL_INCOMPLETE',
    backfillComplete ? 'pass' : 'warning',
    `기존 상품 자동 분류 ${backfillTerminal}/${inventory}건, 처리 실패 ${input.database.legacyBackfillFailedCount ?? 0}건입니다.`,
  );

  const transportReady = input.credentials.oag && input.credentials.cirium;
  add(
    transportReady ? 'V6_TRANSPORT_PROVIDERS_READY' : 'V6_TRANSPORT_PROVIDERS_INCOMPLETE',
    transportReady ? 'pass' : 'warning',
    transportReady ? 'OAG·Cirium 독립 항공 일정 검증이 연결됐습니다.' : '항공 시간 누락 자동 보완은 공급사 원문 범위로 제한됩니다.',
  );

  if (!input.credentials.ocrEnabled) {
    add('V6_OCR_DISABLED', 'pass', 'OCR 문서는 자동 공개 대상에서 제외됩니다.');
  } else {
    const ocrReady = input.credentials.clova && input.credentials.googleDocumentAi;
    add(
      ocrReady ? 'V6_OCR_PROVIDERS_READY' : 'V6_OCR_PROVIDERS_INCOMPLETE',
      ocrReady ? 'pass' : 'blocked',
      ocrReady ? 'CLOVA·Google OCR 교차검증이 연결됐습니다.' : 'OCR은 켜졌지만 두 공급자 교차검증이 완성되지 않았습니다.',
    );
  }

  add(
    input.credentials.mediaProvider ? 'V6_REFERENCE_MEDIA_PROVIDER_READY' : 'V6_REFERENCE_MEDIA_PROVIDER_MISSING',
    input.credentials.mediaProvider ? 'pass' : 'warning',
    input.credentials.mediaProvider
      ? `라이선스·출처가 기록되는 참고 이미지 자동 보완이 가능합니다. 연결된 revision ${input.database.mediaReadyRevisionCount ?? 0}건입니다.`
      : '이미지 없는 상품은 안전 축약 공개되며 참고 이미지 자동 보완은 하지 않습니다.',
  );

  const cohortReady = (input.database.cohortSampleCount ?? 0) >= 30
    && input.database.cohortCriticalDefectCount === 0
    && (input.database.eligibleCohortCount ?? 0) > 0;
  add(
    cohortReady ? 'V6_COHORT_QUALITY_PASSED' : 'V6_COHORT_QUALITY_INCOMPLETE',
    cohortReady ? 'pass' : 'warning',
    cohortReady
      ? `운영 표본 ${input.database.cohortSampleCount}건에서 치명적 결함 0건입니다.`
      : `운영 표본 ${input.database.cohortSampleCount ?? 0}건, 치명적 결함 ${input.database.cohortCriticalDefectCount ?? 0}건, 공개 가능 cohort ${input.database.eligibleCohortCount ?? 0}개입니다.`,
  );

  if ((input.database.uniqueSourceCount ?? 0) < 40) {
    recommendations.push(`현재 고유 원문 ${input.database.uniqueSourceCount ?? 0}개입니다. 40개 고정 HWP 표본을 모두 workflow로 검증해야 합니다.`);
  }
  if (!backfillComplete) recommendations.push('기존 상품 전량을 verified/degraded/blocked로 자동 분류해야 합니다.');
  if (!transportReady) recommendations.push('전면 자동화를 위해 OAG와 Cirium 계정을 연결해야 합니다.');
  if (!cohortReady) recommendations.push('운영 무작위 감사 표본 30건 이상에서 치명적 결함 0건을 확인해야 합니다.');

  const canaryBlockerCodes = new Set([
    'V6_SCHEMA_UNAVAILABLE',
    'V6_AUTHORITY_MODE_MISMATCH',
    'V6_SCHEMA_MANIFEST_UNVERIFIED',
    'V6_LEGACY_PUBLICATION_RPC_EXECUTABLE',
    'V6_WORKFLOW_DISABLED',
    'V6_PROOF_SECRET_MISSING',
    'V6_BROWSER_PROOF_RUNTIME_MISSING',
    'V6_OCR_PROVIDERS_INCOMPLETE',
    'V6_STALE_JOBS_PRESENT',
    'V6_CORPUS_BENCHMARK_NOT_PASSED',
  ]);
  const publicationBlockerCodes = new Set([
    ...canaryBlockerCodes,
    'V6_PUBLICATION_LOCKED',
    'V6_PUBLICATION_FREEZE_MISMATCH',
    'V6_AUTHORITY_NOT_KERNEL',
  ]);
  const readyForCanary = !checks.some(check => check.status === 'blocked' && canaryBlockerCodes.has(check.code));
  const readyForPublication = !checks.some(check => check.status === 'blocked' && publicationBlockerCodes.has(check.code));
  const readyForFullCohort = readyForPublication && transportReady && backfillComplete && cohortReady;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    readyForCanary,
    readyForPublication,
    readyForFullCohort,
    checks,
    recommendations: [...new Set(recommendations)],
    database: input.database,
  };
}
