import { describe, expect, it } from 'vitest';

import { diagnosePublicSnapshotGeneration } from './public-snapshot-diagnostics';
import { buildPublicPackageSnapshot } from './public-snapshot';
import { evaluatePublicSnapshotPublishGate } from './publish-gate';

function samplePackage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sample-yanji-baekdu',
    package_revision: 1,
    title: '\uC5F0\uAE38 5\uC131 \uC628\uCC9C 4\uBC155\uC77C',
    destination: '\uC5F0\uAE38',
    duration: 5,
    nights: 4,
    price: 599000,
    price_dates: [{ date: '2026-07-12', price: 599000, confirmed: false }],
    products: {
      display_name: '\uC5F0\uAE38\u00B7\uBC31\uB450\uC0B0 \uD328\uD0A4\uC9C0',
      thumbnail_urls: ['https://cdn.yeosonam.com/packages/yanji.jpg'],
    },
    raw_text: [
      '\uC5F0\uAE38 5\uC131 \uC628\uCC9C 4\uBC155\uC77C',
      '\uC120\uD0DD\uAD00\uAD11 \uB178\uC635\uC158',
      '\uD3EC\uD568\uB0B4\uC5ED',
      '\uC655\uBCF5\uD56D\uACF5\uB8CC',
      '\uC219\uBC15\uB8CC',
      '\uC2DD\uC0AC(\uC77C\uC815\uD45C)',
      '\uAD00\uAD11\uC9C0\uC785\uC7A5\uB8CC',
      '\uD604\uC9C0\uCC28\uB7C9',
      '\uAC00\uC774\uB4DC',
      '\uBD88\uD3EC\uD568\uB0B4\uC5ED',
      '\uAC1C\uC778\uACBD\uBE44',
      '\uAE30\uC0AC/\uAC00\uC774\uB4DC\uACBD\uBE44 $50/\uC778',
      'DAY 1 \uC5F0\uAE38 \uC774\uB3D9',
      'DAY 2 \uBC31\uB450\uC0B0 \uCC9C\uC9C0 \uAD00\uAD11',
    ].join('\n'),
    inclusions: [
      '\uC655\uBCF5\uD56D\uACF5\uB8CC',
      '\uCC28\uB7C9',
      '\uAC00\uC774\uB4DC',
      '599',
      '000\uC6D0',
      '\uB178\uC635\uC158',
    ],
    excludes: [
      '\uBD88\uD3EC\uD568\uB0B4\uC5ED',
      '\uAC1C\uC778\uACBD\uBE44',
      '\uAE30\uC0AC/\uAC00\uC774\uB4DC\uACBD\uBE44 $50/\uC778',
      '7\uC6D4 5',
    ],
    optional_tours: [
      '7\uC6D4 5',
      '599',
      '000\uC6D0',
      '\uD3EC\uD568\uB0B4\uC5ED',
      '\uCC28\uB7C9',
      '\uAC00\uC774\uB4DC',
      '\uB178\uC635\uC158',
    ],
    itinerary_data: {
      days: [
        { day: 1, schedule: [{ activity: '\uC5F0\uAE38 \uC774\uB3D9', attraction_ids: [] }] },
        {
          day: 2,
          schedule: [
            {
              activity: '\uBC31\uB450\uC0B0 \uCC9C\uC9C0 \uAD00\uAD11',
              attraction_ids: ['5728e681-636b-42fa-87b5-a2f0b7b0379c'],
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function diagnosticByField(report: ReturnType<typeof diagnosePublicSnapshotGeneration>) {
  return new Map(report.diagnostics.map(item => [item.field, item]));
}

describe('public snapshot generation diagnostics', () => {
  it('classifies a regenerated no-option package by customer-facing field', () => {
    const pkg = samplePackage();
    const { snapshot } = buildPublicPackageSnapshot(pkg);
    const report = diagnosePublicSnapshotGeneration({ pkg, snapshot });
    const byField = diagnosticByField(report);

    expect(report.overall_status).toBe('generated');
    expect(byField.get('title')?.status).toBe('generated');
    expect(byField.get('summary')?.status).toBe('generated');
    expect(byField.get('price')?.status).toBe('generated');
    expect(byField.get('itinerary')?.status).toBe('generated');
    expect(byField.get('terms')?.status).toBe('generated');
    expect(byField.get('optional_tours')?.status).toBe('generated');
    expect(byField.get('optional_tours')?.evidence).toEqual(expect.arrayContaining(['optional_tour_status=none_explicit']));
    expect(snapshot.optional_tours_public).toEqual([]);
    expect(snapshot.inclusions_public).not.toEqual(expect.arrayContaining(['599', '000\uC6D0', '\uB178\uC635\uC158']));
  });

  it('reports what to regenerate when price evidence is missing but present in source text', () => {
    const pkg = samplePackage({
      price: null,
      price_dates: [],
      raw_text: [
        '\uB2E4\uB0AD/\uD638\uC774\uC548 3\uBC155\uC77C \uB178\uC635\uC158',
        '\uCD9C\uBC1C\uC77C 2026-08-01',
        '\uC131\uC778 1\uC778 \uC0C1\uD488\uAC00 799,000\uC6D0',
        '\uD3EC\uD568\uB0B4\uC5ED',
        '\uC655\uBCF5\uD56D\uACF5\uB8CC',
        'This supplier raw text includes enough lines to safely reconstruct a source-backed price table.',
      ].join('\n'),
    });
    const { snapshot } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg: {
        ...pkg,
        images_public: snapshot.images_public,
        hero_image_url: snapshot.package.hero_image_url,
        thumbnail_urls: snapshot.package.thumbnail_urls,
      },
      publicSnapshotTitle: snapshot.public_title,
      publicSnapshotHash: 'snapshot-hash',
      snapshotExists: true,
      customerOpenContractOk: true,
      routeTextDump: snapshot.route_text_dump,
      mobileProof: {
        ok: false,
        reason: 'not checked in unit test',
        proof: null,
      },
    });
    const report = diagnosePublicSnapshotGeneration({ pkg, snapshot, hardBlockers: gate.hard_blockers });
    const price = diagnosticByField(report).get('price');

    expect(price?.status).toBe('repairable');
    expect(price?.evidence).toEqual(expect.arrayContaining(['raw_price_pattern_present']));
    expect(price?.repair_actions.join('\n')).toContain('price_dates');
    expect(gate.required_actions.length).toBeGreaterThan(0);
    expect(report.repair_actions.join('\n')).toContain('source-backed departure date');
  });

  it('does not mark short title-only source text as automatically repairable', () => {
    const pkg = samplePackage({
      raw_text: '\uC7A5\uAC00\uACC4 \uB178\uD301\uB178\uC635\uC158 3\uBC154\uC77C',
      price: 699000,
      price_dates: [],
      itinerary_data: {
        days: [],
        meta: { days: 4, nights: 3, destination: '\uC7A5\uAC00\uACC4' },
      },
    });
    const { snapshot } = buildPublicPackageSnapshot(pkg);
    const report = diagnosePublicSnapshotGeneration({ pkg, snapshot });
    const byField = diagnosticByField(report);

    expect(byField.get('price')?.status).toBe('blocked');
    expect(byField.get('price')?.evidence).toEqual(expect.arrayContaining(['raw_text_insufficient_for_price_repair']));
    expect(byField.get('itinerary')?.status).toBe('blocked');
    expect(byField.get('itinerary')?.evidence).toEqual(expect.arrayContaining(['raw_itinerary_source_insufficient']));
    expect(report.overall_status).toBe('blocked');
  });

  it('separates customer copy blockers from repairable generation fields', () => {
    const pkg = samplePackage();
    const { snapshot } = buildPublicPackageSnapshot(pkg);
    const report = diagnosePublicSnapshotGeneration({
      pkg,
      snapshot: {
        ...snapshot,
        route_text_dump: [...snapshot.route_text_dump, '\uC608\uC57D \uC989\uC2DC \uD56D\uACF5\u00B7\uC219\uBC15 \uD655\uBCF4', 'Decision guide'],
      },
      hardBlockers: [
        {
          code: 'risky_reservation_claim',
          message: 'customer copy contains risky reservation/guarantee wording',
          severity: 'critical',
        },
        {
          code: 'english_internal_copy',
          message: 'internal or English operational copy is customer-visible: Decision guide',
          severity: 'critical',
        },
      ],
    });
    const byField = diagnosticByField(report);

    expect(report.overall_status).toBe('blocked');
    expect(byField.get('customer_copy')?.status).toBe('blocked');
    expect(byField.get('customer_copy')?.repair_actions.join('\n')).toContain('approved customer templates');
    expect(byField.get('terms')?.status).toBe('generated');
    expect(byField.get('optional_tours')?.status).toBe('generated');
  });

  it('marks hidden optional tour source pollution as an optional-tour process repair', () => {
    const pkg = samplePackage();
    const { snapshot } = buildPublicPackageSnapshot(pkg);
    const report = diagnosePublicSnapshotGeneration({
      pkg,
      snapshot,
      hardBlockers: [
        {
          code: 'masked_data_pollution',
          fieldPath: 'optional_tours.0',
          message: 'optional_tours contains price-table or inclusion fragments hidden by renderer',
          severity: 'critical',
        },
      ],
    });
    const optionalTours = diagnosticByField(report).get('optional_tours');

    expect(report.overall_status).toBe('blocked');
    expect(optionalTours?.status).toBe('repairable');
    expect(optionalTours?.process_stage).toBe('optional_tour_quarantine_backfill');
    expect(optionalTours?.required_source_evidence).toEqual(expect.arrayContaining([
      'explicit optional-tour source section',
      'paid option name',
    ]));
    expect(optionalTours?.repair_actions.join('\n')).toContain('Reclassify optional tour candidates by source section');
  });

  it('marks hidden itinerary source pollution as an itinerary rebuild instead of a clean generated itinerary', () => {
    const pkg = samplePackage();
    const { snapshot } = buildPublicPackageSnapshot(pkg);
    const report = diagnosePublicSnapshotGeneration({
      pkg,
      snapshot,
      hardBlockers: [
        {
          code: 'masked_data_pollution',
          fieldPath: 'itinerary_data.days.1.schedule.2.activity',
          message: 'itinerary_data contains a price-table fragment hidden by renderer',
          severity: 'critical',
        },
      ],
    });
    const itinerary = diagnosticByField(report).get('itinerary');

    expect(report.overall_status).toBe('blocked');
    expect(itinerary?.status).toBe('repairable');
    expect(itinerary?.process_stage).toBe('itinerary_quarantine_backfill');
    expect(itinerary?.evidence.join('\n')).toContain('masked_data_pollution');
    expect(itinerary?.repair_actions.join('\n')).toContain('Rebuild itinerary day rows from the source itinerary section');
  });
});
