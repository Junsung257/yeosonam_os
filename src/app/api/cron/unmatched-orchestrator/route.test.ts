import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const routePath = join(process.cwd(), 'src/app/api/cron/unmatched-orchestrator/route.ts');
const promoteInternalRoutePath = join(process.cwd(), 'src/app/api/cron/promote-internal-candidates/route.ts');
const entityMasterCandidatesRoutePath = join(process.cwd(), 'src/app/api/cron/entity-master-candidates/route.ts');
const analyzeUnmatchedCandidatesScriptPath = join(process.cwd(), 'scripts/analyze-unmatched-master-candidates.ts');
const unmatchedFinalPipelineScriptPath = join(process.cwd(), 'scripts/run-unmatched-final-pipeline.ts');
const verifyEntityMasterCandidatesScriptPath = join(process.cwd(), 'scripts/verify-entity-master-candidates.ts');
const mobileQualityEngineScriptPath = join(process.cwd(), 'scripts/run-product-registration-mobile-quality-engine.ts');
const mobileReadinessRepairScriptPath = join(process.cwd(), 'scripts/repair-product-mobile-readiness-candidates.ts');

describe('unmatched orchestrator route', () => {
  it('runs cron steps in-process instead of self-calling HTTP cron endpoints', () => {
    const source = readFileSync(routePath, 'utf8');

    expect(source).toContain('unmatchedClassifyGet');
    expect(source).toContain('resweepUnmatchedGet');
    expect(source).toContain('unmatchedAutoResolveGet');
    expect(source).not.toContain('fetch(url');
    expect(source).not.toContain("headers: authorization ? { authorization } : undefined");
  });

  it('re-enriches affected packages after internal attraction candidate promotion', () => {
    const source = readFileSync(promoteInternalRoutePath, 'utf8');

    expect(source).toContain("from '@/lib/package-reenrich-on-attraction-change'");
    expect(source).toContain('affectedAttractionIds.add(attractionId)');
    expect(source).toContain('affectedPackageIds.add(sourceRow.package_id)');
    expect(source).toContain('reEnrichAffectedPackages([...affectedAttractionIds]');
    expect(source).toContain('forceRevalidate: true');
    expect(source).toContain('reenrich,');
    expect(source).toContain('minScore: minScoreFrom(request)');
    expect(source).toContain(".gte('verification_score', minScore)");
    expect(source).toContain(".contains('source_context', { mobile_landing_impact: true })");
    expect(source).toContain('for (const packageId of packageIdsFrom(row)) affectedPackageIds.add(packageId)');
  });

  it('marks package-scoped master candidates as mobile landing impact candidates', () => {
    const sources = [
      readFileSync(entityMasterCandidatesRoutePath, 'utf8'),
      readFileSync(analyzeUnmatchedCandidatesScriptPath, 'utf8'),
      readFileSync(unmatchedFinalPipelineScriptPath, 'utf8'),
    ];

    for (const source of sources) {
      expect(source).toContain('mobile_landing_impact: group.packageIds.size > 0');
    }
  });

  it('lets candidate verification target one destination before promotion', () => {
    const source = readFileSync(verifyEntityMasterCandidatesScriptPath, 'utf8');

    expect(source).toContain("const destinationFilter = argValue('--destination', '')");
    expect(source).toContain('destination_scope.eq.${destinationFilter}');
    expect(source).toContain('region_scope.eq.${destinationFilter}');
    expect(source).toContain('country_scope.eq.${destinationFilter}');
    expect(source).toContain('destination: destinationFilter || null');
  });

  it('passes destination scope through mobile quality verification and promotion', () => {
    const source = readFileSync(mobileQualityEngineScriptPath, 'utf8');

    expect(source).toContain("const destination = argValue('--destination', '')");
    expect(source).toContain('scripts/verify-entity-master-candidates.ts');
    expect(source).toContain('scripts/promote-verified-attraction-candidates.ts');
    expect(source.match(/`--destination=\$\{destination\}`/g)).toHaveLength(2);
  });

  it('uses saved package minimum departure when rebuilding V3 drafts from split detail blocks', () => {
    const source = readFileSync(mobileReadinessRepairScriptPath, 'utf8');

    expect(source).toContain('min_participants');
    expect(source).toContain('applyPackageMinimumDeparture(v3, pkg)');
    expect(source).toContain('travel_packages.min_participants=');
    expect(source).toContain('evaluateProductRegistrationV3Gate(v3.structure_plan, v3.ledger, v3.match_summary)');
  });
});
