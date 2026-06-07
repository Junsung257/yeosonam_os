import type { ImprovementLedgerEvent } from './improvement-ledger';
import type { PatternCandidate } from './pattern-mining';

export type PromotionWorkItem = {
  id: string;
  candidateId: string;
  kind: PatternCandidate['kind'];
  signature: string;
  status: 'review_required';
  risk: PatternCandidate['risk'];
  evidenceCount: number;
  evidenceRawTextHashes: string[];
  evidencePackageIds: string[];
  fixturePlan: {
    fixtureId: string;
    sourceHashes: string[];
    assertions: string[];
  };
  parserRulePlan: {
    targetModules: string[];
    ruleSummary: string;
    safetyChecks: string[];
  };
  verificationCommands: string[];
  nextAction: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'candidate';
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function eventMatchesCandidate(event: ImprovementLedgerEvent, candidate: PatternCandidate): boolean {
  if (candidate.kind === 'blocker_signature') {
    return event.normalizedBlockerSignatures.includes(candidate.signature);
  }
  if (candidate.kind === 'supplier_format') {
    return event.detectedFormat === candidate.signature;
  }
  if (candidate.kind === 'deterministic_fix') {
    return event.autoFixesApplied.some(fix => fix.kind === 'deterministic' && fix.field === candidate.signature);
  }
  if (candidate.kind === 'schedule_pollution') {
    return event.autoFixesApplied.some(fix => fix.field.includes('schedule') && fix.reason === candidate.signature);
  }
  if (candidate.kind === 'render_failure') {
    return [...event.packagesAudit.failures, ...event.a4Audit.failures].includes(candidate.signature);
  }
  return false;
}

function targetModulesFor(candidate: PatternCandidate): string[] {
  const text = `${candidate.kind} ${candidate.signature}`.toLowerCase();
  if (text.includes('price') || text.includes('product_prices') || text.includes('price_dates')) {
    return [
      'src/lib/product-registration/price-recovery.ts',
      'src/lib/parser/deterministic/price-ir',
      'src/lib/product-registration/deliverability-gate.ts',
    ];
  }
  if (text.includes('schedule') || text.includes('itinerary') || text.includes('flight') || text.includes('hotel')) {
    return [
      'src/lib/product-registration/itinerary-normalization.ts',
      'src/lib/product-registration/itinerary-quality-gate.ts',
      'src/lib/supplier-raw-deterministic-facts.ts',
    ];
  }
  if (candidate.kind === 'render_failure') {
    return [
      'src/lib/render-contract.ts',
      'src/app/packages/[id]/DetailClient.tsx',
      'src/components/itinerary/A4PosterLayout.tsx',
    ];
  }
  if (candidate.kind === 'supplier_format') {
    return [
      'src/lib/parser/catalog-pre-split.ts',
      'src/lib/supplier-raw-deterministic-facts.ts',
      'src/lib/product-registration/upload-registration-preparation.ts',
    ];
  }
  return [
    'src/lib/product-registration/deliverability-gate.ts',
    'src/lib/product-registration/register-product-from-raw.ts',
    'src/lib/product-registration/golden-corpus/evaluator.ts',
  ];
}

function assertionsFor(candidate: PatternCandidate): string[] {
  if (candidate.kind === 'deterministic_fix' && candidate.signature.includes('price')) {
    return [
      'product_prices contains customer-visible adult_selling_price rows',
      'price_dates contains date-level minimums matching product_prices',
      'optional-tour or surcharge amounts do not pollute product_prices',
    ];
  }
  if (candidate.kind === 'schedule_pollution' || candidate.signature.includes('schedule')) {
    return [
      'standalone flight code, time, vehicle, meal, hotel, and region tokens are not schedule activities',
      'flight, hotel, meal, and region facts move to structured itinerary fields',
      'mobile landing and A4 render without itinerary pollution blockers',
    ];
  }
  if (candidate.kind === 'supplier_format') {
    return [
      'product split count matches source section boundaries',
      'each product keeps its own sectionRawText evidence',
      'destination, prices, itinerary days, and render readiness remain customer deliverable',
    ];
  }
  if (candidate.kind === 'render_failure') {
    return [
      '/packages payload uses customer-safe product_prices adult_selling_price',
      'A4 payload uses travel_packages.price_dates and excludes forbidden supplier labels',
      'render audit has no blocker for this fixture',
    ];
  }
  return [
    'blocker signature is reproduced in the fixture before the fix',
    'deterministic parser or gate removes the blocker after the fix',
    'golden corpus and product-registration eval stay green',
  ];
}

export function buildPromotionWorkItems(input: {
  candidates: PatternCandidate[];
  events: ImprovementLedgerEvent[];
  maxItems?: number;
}): PromotionWorkItem[] {
  return input.candidates
    .filter(candidate => candidate.promotionReady)
    .slice(0, input.maxItems ?? 10)
    .map(candidate => {
      const evidenceEvents = input.events.filter(event => eventMatchesCandidate(event, candidate));
      const sourceHashes = unique(evidenceEvents.map(event => event.rawTextHash)).slice(0, 5);
      const evidencePackageIds = unique(evidenceEvents.map(event => event.packageId).filter((id): id is string => Boolean(id))).slice(0, 5);
      const fixtureId = `macro-${candidate.kind}-${slugify(candidate.signature)}`;
      return {
        id: `promotion:${candidate.id}`.slice(0, 200),
        candidateId: candidate.id,
        kind: candidate.kind,
        signature: candidate.signature,
        status: 'review_required',
        risk: candidate.risk,
        evidenceCount: candidate.evidenceCount,
        evidenceRawTextHashes: sourceHashes,
        evidencePackageIds,
        fixturePlan: {
          fixtureId,
          sourceHashes,
          assertions: assertionsFor(candidate),
        },
        parserRulePlan: {
          targetModules: targetModulesFor(candidate),
          ruleSummary: `Promote reviewed ${candidate.kind} pattern: ${candidate.signature}`,
          safetyChecks: [
            'Do not edit src/app/api/upload/route.ts for supplier-specific logic',
            'Add or update a full raw-text golden fixture before parser changes',
            'Keep macro output as a reviewed patch candidate; do not auto-mutate production parser rules',
          ],
        },
        verificationCommands: [
          'npx vitest run src/lib/parser/deterministic src/lib/product-registration src/lib/upload-validator.test.ts src/lib/price-dates.test.ts src/lib/upload-verify.test.ts',
          'npm run eval:product-registration:ci',
          'npm run type-check',
          'node --check scripts/audit-product-mobile-landing-readiness.mjs',
        ],
        nextAction: 'Review evidence hashes, add the fixture, implement the deterministic rule, then run the verification commands.',
      };
    });
}
