import { evidenceCoverage, type SourceEvidenceMap } from '@/lib/source-evidence';

export type PublishGateSeverity = 'medium' | 'high' | 'critical';

export type PublishGateFailedCheck = {
  id?: string;
  severity?: string | null;
  message?: string | null;
  passed?: boolean | null;
};

export type PublishGateInput = {
  auditStatus?: string | null;
  auditReport?: unknown;
  failedChecks?: PublishGateFailedCheck[];
  sourceEvidence?: SourceEvidenceMap | null;
  requiredEvidenceFields?: string[];
  minEvidenceCoverage?: number;
  requireCompletedAudit?: boolean;
};

export type PublishGateDecision = 'allow' | 'force_required' | 'block';

export type PublishGateResult = {
  decision: PublishGateDecision;
  status: 'clean' | 'warnings' | 'blocked' | 'unknown';
  reasons: string[];
  warnings: string[];
  failedChecks: PublishGateFailedCheck[];
  auditReport?: unknown;
};

function normalizeSeverity(severity?: string | null): PublishGateSeverity {
  if (severity === 'critical') return 'critical';
  if (severity === 'medium') return 'medium';
  return 'high';
}

export function evaluateProductPublishGate(input: PublishGateInput): PublishGateResult {
  const failedChecks = (input.failedChecks ?? []).filter(c => c && c.passed === false);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const auditStatus = input.auditStatus ?? null;
  const requireCompletedAudit = input.requireCompletedAudit ?? true;
  const requiredEvidenceFields = input.requiredEvidenceFields ?? [];
  const minEvidenceCoverage = input.minEvidenceCoverage ?? 0;

  if (requireCompletedAudit && !auditStatus) {
    reasons.push('감사 상태가 없습니다. 원문 대조/품질 검증을 먼저 실행해야 합니다.');
  }

  if (auditStatus === 'blocked') {
    reasons.push('audit_status=blocked 입니다. 수정 후 재검증이 필요합니다.');
  }

  for (const check of failedChecks) {
    const severity = normalizeSeverity(check.severity);
    const label = check.message || check.id || '품질 검사 실패';
    if (severity === 'critical') {
      reasons.push(`critical 품질 실패: ${label}`);
    } else {
      warnings.push(`${severity} 품질 경고: ${label}`);
    }
  }

  if (requiredEvidenceFields.length > 0) {
    const coverage = evidenceCoverage(input.sourceEvidence, requiredEvidenceFields);
    if (coverage.ratio < minEvidenceCoverage) {
      reasons.push(
        `원문 근거 coverage ${(coverage.ratio * 100).toFixed(0)}% ` +
        `(${coverage.covered}/${coverage.total}) — 누락: ${coverage.missing.slice(0, 8).join(', ')}`,
      );
    } else if (coverage.missing.length > 0) {
      warnings.push(
        `원문 근거 일부 누락 ${coverage.missing.length}건: ${coverage.missing.slice(0, 8).join(', ')}`,
      );
    }
  }

  if (auditStatus === 'warnings') {
    warnings.push('audit_status=warnings 입니다. 감사 리포트 확인 후 강제 승인만 가능합니다.');
  }

  if (reasons.length > 0) {
    return {
      decision: 'block',
      status: 'blocked',
      reasons,
      warnings,
      failedChecks,
      auditReport: input.auditReport,
    };
  }

  if (warnings.length > 0) {
    return {
      decision: 'force_required',
      status: 'warnings',
      reasons,
      warnings,
      failedChecks,
      auditReport: input.auditReport,
    };
  }

  return {
    decision: 'allow',
    status: auditStatus === 'clean' || auditStatus === 'info' ? 'clean' : 'unknown',
    reasons,
    warnings,
    failedChecks,
    auditReport: input.auditReport,
  };
}
