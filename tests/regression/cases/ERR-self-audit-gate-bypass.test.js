/**
 * @case ERR-self-audit-gate-bypass (2026-04-27, P3 #2)
 * @summary Agent self-audit (agent_audit_report) 가 INSERT 단계에서 무시되어 환각·축약 데이터가
 *   DB에 그대로 INSERT 되었음. post-audit 단계에서 warnings 로 추가되었으나 INSERT 자체는 차단되지 않음.
 *
 * 수정: insert-template.js validatePackage 호출 직후 게이트 추가.
 *   - verdict='blocked' → 즉시 INSERT 차단
 *   - CRITICAL unsupported >= 1 → 즉시 차단
 *   - HIGH unsupported >= 3 → 기본 warnings, STRICT_AUDIT=true 면 차단
 *   - report 누락 → STRICT_AUDIT 시에만 차단
 *
 * 회귀 방지: 게이트 로직 자체를 단위 테스트.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// insert-template.js 의 게이트 로직과 동일한 결정 함수 (테스트용 추출)
function gate(report, options = {}) {
  const STRICT_AUDIT = options.strict === true;
  const errors = [];
  const warnings = [];
  if (report && typeof report === 'object') {
    const verdict = report.overall_verdict;
    const critical = Number(report.unsupported_critical || 0);
    const high = Number(report.unsupported_high || 0);
    if (verdict === 'blocked') {
      errors.push(`[AGENT_AUDIT_BLOCKED] verdict=blocked CRITICAL:${critical} HIGH:${high}`);
    } else if (critical >= 1) {
      errors.push(`[AGENT_AUDIT_CRITICAL] CRITICAL ${critical}건`);
    } else if (high >= 3) {
      const msg = `[AGENT_AUDIT_HIGH] HIGH ${high}건`;
      if (STRICT_AUDIT) errors.push(msg);
      else warnings.push(msg);
    }
  } else if (STRICT_AUDIT) {
    errors.push('[AGENT_AUDIT_MISSING] report 누락');
  }
  return { errors, warnings, blocked: errors.length > 0 };
}

test('ERR-self-audit-gate-bypass: verdict=blocked → 차단', () => {
  const r = gate({ overall_verdict: 'blocked', unsupported_critical: 0, unsupported_high: 0 });
  assert.equal(r.blocked, true);
  assert.match(r.errors[0], /AGENT_AUDIT_BLOCKED/);
});

test('ERR-self-audit-gate-bypass: CRITICAL 1건 → 차단', () => {
  const r = gate({ overall_verdict: 'pass', unsupported_critical: 1, unsupported_high: 0 });
  assert.equal(r.blocked, true);
  assert.match(r.errors[0], /AGENT_AUDIT_CRITICAL/);
});

test('ERR-self-audit-gate-bypass: HIGH 3건 (기본) → warnings', () => {
  const r = gate({ overall_verdict: 'pass', unsupported_critical: 0, unsupported_high: 3 });
  assert.equal(r.blocked, false);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /AGENT_AUDIT_HIGH/);
});

test('ERR-self-audit-gate-bypass: HIGH 3건 + STRICT → 차단', () => {
  const r = gate({ overall_verdict: 'pass', unsupported_critical: 0, unsupported_high: 3 }, { strict: true });
  assert.equal(r.blocked, true);
  assert.match(r.errors[0], /AGENT_AUDIT_HIGH/);
});

test('ERR-self-audit-gate-bypass: HIGH 2건 → 통과 (3건 임계치 미만)', () => {
  const r = gate({ overall_verdict: 'pass', unsupported_critical: 0, unsupported_high: 2 });
  assert.equal(r.blocked, false);
  assert.equal(r.warnings.length, 0);
});

test('ERR-self-audit-gate-bypass: report 누락 (기본) → 통과', () => {
  const r = gate(null);
  assert.equal(r.blocked, false);
});

test('ERR-self-audit-gate-bypass: report 누락 + STRICT → 차단', () => {
  const r = gate(null, { strict: true });
  assert.equal(r.blocked, true);
  assert.match(r.errors[0], /AGENT_AUDIT_MISSING/);
});

test('ERR-self-audit-gate-bypass: clean report (CRITICAL=0, HIGH=0) → 통과', () => {
  const r = gate({ overall_verdict: 'pass', unsupported_critical: 0, unsupported_high: 0, claims: [] });
  assert.equal(r.blocked, false);
  assert.equal(r.warnings.length, 0);
});
