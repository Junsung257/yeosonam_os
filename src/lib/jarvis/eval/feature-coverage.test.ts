import { describe, expect, it } from 'vitest';
import type { AgentType } from '../types';
import {
  JARVIS_OS_FEATURE_COVERAGE_CASES,
  evaluateJarvisFeatureCoverage,
} from './feature-coverage';

const ALL_AGENT_TYPES: AgentType[] = ['operations', 'products', 'finance', 'marketing', 'sales', 'system'];

describe('Jarvis OS feature coverage', () => {
  it('covers every major Yeosonam OS domain with a passing route contract', () => {
    const summary = evaluateJarvisFeatureCoverage();

    expect(summary.total).toBeGreaterThanOrEqual(13);
    expect(summary.status).toBe('pass');
    expect(summary.score).toBe(100);
    expect(summary.failed).toBe(0);
    expect(summary.missingAgents).toEqual([]);
    expect(summary.coveredAgents).toEqual(ALL_AGENT_TYPES);
    expect(Object.values(summary.uncoveredToolNames).flat()).toEqual([]);
    expect(Object.values(summary.undeclaredCoveredToolNames).flat()).toEqual([]);
  });

  it('keeps customer product traffic on the concierge RAG specialist', () => {
    const summary = evaluateJarvisFeatureCoverage();
    const customerProduct = summary.results.find((result) => result.id === 'products.customer-concierge-rag');

    expect(customerProduct?.actualSpecialistId).toBe('products.concierge_rag');
    expect(customerProduct?.routingMethod).toBe('surface_override');
  });

  it('requires approval boundaries for high-risk feature cases', () => {
    const highRiskCases = JARVIS_OS_FEATURE_COVERAGE_CASES.filter((testCase) => (
      testCase.riskLevel === 'high' || testCase.riskLevel === 'critical'
    ));

    expect(highRiskCases.length).toBeGreaterThan(0);
    expect(highRiskCases.every((testCase) => testCase.requiresApprovalBoundary)).toBe(true);
  });

  it('assigns every declared Jarvis tool to a feature coverage owner', () => {
    const summary = evaluateJarvisFeatureCoverage();
    const coveredTools = Object.values(summary.coveredToolNames).flat();

    expect(coveredTools).toContain('adjust_mileage');
    expect(coveredTools).toContain('create_mileage_event');
    expect(coveredTools.length).toBeGreaterThan(80);
    expect(Object.values(summary.uncoveredToolNames).every((items) => items.length === 0)).toBe(true);
  });
});
