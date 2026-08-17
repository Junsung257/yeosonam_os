import { createHash } from 'node:crypto';

import {
  evaluateProductRegistrationV6Policy,
} from '@/lib/product-registration-v6/terminal-policy';
import { PRODUCT_REGISTRATION_V6_POLICY_VERSION } from '@/lib/product-registration-v6/types';
import type {
  KernelFinding,
  KernelFindingSeverity,
  PublicationDecision,
  RegistrationKernelInput,
} from './contracts';

function stableCode(reason: string): string {
  const matches = [...reason.matchAll(/(?:^|:)([A-Z][A-Z0-9_]{2,})(?=:|\s|$)/gu)];
  if (matches.length > 0) return matches[matches.length - 1]?.[1] ?? 'REGISTRATION_POLICY_FINDING';
  if (/판매가와 출발일 적용 관계/u.test(reason)) return 'PRICE_DEPARTURE_SCOPE_AMBIGUOUS';
  if (/판매가 금액이 원문 evidence/u.test(reason)) return 'PRICE_EVIDENCE_REPLAY_FAILED';
  if (/성인 기준 판매가/u.test(reason)) return 'ADULT_SALE_PRICE_INVALID';
  if (/통화 코드/u.test(reason)) return 'CURRENCY_AMBIGUOUS';
  if (/출발 연도/u.test(reason)) return 'DEPARTURE_YEAR_UNRESOLVED';
  return 'REGISTRATION_POLICY_FINDING';
}

function fieldPath(reason: string, code: string): string {
  const codeIndex = reason.lastIndexOf(`:${code}`);
  if (codeIndex > 0) return reason.slice(0, codeIndex);
  const messageIndex = reason.indexOf(': ');
  if (messageIndex > 0 && /^(?:sections|package)(?:\[|:)/u.test(reason)) {
    return reason.slice(0, messageIndex);
  }
  return 'registration';
}

export function kernelFindingFromReason(
  reason: string,
  severity: KernelFindingSeverity,
  ruleVersion = PRODUCT_REGISTRATION_V6_POLICY_VERSION,
): KernelFinding {
  const code = stableCode(reason);
  const path = fieldPath(reason, code);
  return {
    fieldPath: path,
    severity,
    code,
    message: reason,
    sourceAnchor: path.startsWith('sections[') ? path : null,
    ruleVersion,
    resolutionState: severity === 'blocker' ? 'blocked' : 'degraded',
  };
}

function uniqueFindings(findings: KernelFinding[]): KernelFinding[] {
  const byIdentity = new Map<string, KernelFinding>();
  for (const finding of findings) {
    const identity = `${finding.severity}|${finding.fieldPath}|${finding.code}|${finding.message}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, finding);
  }
  return [...byIdentity.values()];
}

/** The only final terminal-state policy entry point for Registration Kernel.
 * Existing validators are finding producers; none of them may publish or
 * mutate state directly. */
export function evaluateRegistrationPublicationPolicy(
  input: RegistrationKernelInput,
): PublicationDecision {
  const legacyDecision = evaluateProductRegistrationV6Policy(input);
  const findings = uniqueFindings([
    ...legacyDecision.blockers.map(reason => kernelFindingFromReason(reason, 'blocker')),
    ...legacyDecision.degradedReasons.map(reason => kernelFindingFromReason(reason, 'degraded')),
  ]);
  const decisionHash = createHash('sha256').update(JSON.stringify({
    outcome: legacyDecision.outcome,
    terminalOutcome: legacyDecision.terminalOutcome,
    packageIds: legacyDecision.packageIds,
    revisionIds: legacyDecision.revisionIds,
    findings,
    sourceSalePriceDispositions: legacyDecision.sourceSalePriceDispositions,
  })).digest('hex');
  return {
    ...legacyDecision,
    decisionHash,
    findings,
  } as PublicationDecision;
}
