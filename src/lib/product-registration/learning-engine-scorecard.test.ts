import { describe, expect, it } from 'vitest';
import {
  buildLearningEngineEvidenceFromRuntime,
  scoreCentralLearningEngine,
  scoreMacroLearningEngine,
  scoreMicroLearningEngine,
  type MacroLearningEngineEvidence,
  type MicroLearningEngineEvidence,
} from './learning-engine-scorecard';

const readyMicro: MicroLearningEngineEvidence = {
  triggerCoverageReady: true,
  sourceComparisonReady: true,
  autoRepairDisciplineReady: true,
  customerRenderAuditReady: true,
  improvementLedgerReady: true,
  safetyGatesReady: true,
};

const readyMacro: MacroLearningEngineEvidence = {
  ledgerCoverageReady: true,
  patternMiningReady: true,
  canonicalizationReady: true,
  promotionGateReady: true,
  regressionEvidenceReady: true,
  operatorVisibilityReady: true,
};

describe('learning engine scorecard', () => {
  it('scores a complete micro engine as production ready', () => {
    const score = scoreMicroLearningEngine(readyMicro);

    expect(score.total).toBe(100);
    expect(score.status).toBe('production_ready');
    expect(score.blockers).toHaveLength(0);
  });

  it('scores a complete macro engine as production ready', () => {
    const score = scoreMacroLearningEngine(readyMacro);

    expect(score.total).toBe(100);
    expect(score.status).toBe('production_ready');
    expect(score.blockers).toHaveLength(0);
  });

  it('requires both engines and the combined score before production readiness', () => {
    const score = scoreCentralLearningEngine({
      micro: readyMicro,
      macro: {
        ...readyMacro,
        regressionEvidenceReady: false,
      },
    });

    expect(score.macro.total).toBe(80);
    expect(score.combined).toBe(90);
    expect(score.productionReady).toBe(false);
    expect(score.blockers).toEqual(expect.arrayContaining([
      'macro score 80 < 90',
      'combined score 90 < 95',
      expect.stringContaining('macro_regression_evidence'),
    ]));
  });

  it('builds score evidence from runtime capabilities and ledger counts', () => {
    const evidence = buildLearningEngineEvidenceFromRuntime({
      microEventsCaptured: 50,
      macroCandidatesGenerated: 3,
      promotionReadyCandidates: 1,
      hasAutoQARunner: true,
      hasRenderAuditors: true,
      hasImprovementLedger: true,
      hasPatternMining: true,
      hasPromotionWorkflow: true,
      routeBoundaryClean: true,
      fullRegressionVerified: true,
      operatorReportAvailable: true,
    });
    const score = scoreCentralLearningEngine(evidence);

    expect(score.micro.total).toBe(100);
    expect(score.macro.total).toBe(100);
    expect(score.productionReady).toBe(true);
  });

  it('does not grant macro promotion points without a promotion workflow', () => {
    const evidence = buildLearningEngineEvidenceFromRuntime({
      microEventsCaptured: 50,
      macroCandidatesGenerated: 3,
      promotionReadyCandidates: 1,
      hasAutoQARunner: true,
      hasRenderAuditors: true,
      hasImprovementLedger: true,
      hasPatternMining: true,
      hasPromotionWorkflow: false,
      routeBoundaryClean: true,
      fullRegressionVerified: true,
      operatorReportAvailable: true,
    });
    const score = scoreCentralLearningEngine(evidence);

    expect(score.macro.total).toBe(80);
    expect(score.productionReady).toBe(false);
    expect(score.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('macro_promotion_gate'),
    ]));
  });
});
