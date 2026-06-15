import { describe, expect, it } from 'vitest';
import {
  classifyProductRegistrationFailure,
  summarizeProductRegistrationFailures,
} from './failure-diagnostics';

describe('product registration failure diagnostics', () => {
  it('classifies source-backed price date disagreements as stable blocker codes', () => {
    const diagnostics = classifyProductRegistrationFailure(
      'Price source audit failed: price date disagreement: source-backed dates do not overlap recovered dates',
    );

    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
      'PRICE_DATE_DISAGREEMENT',
    ]));
    expect(diagnostics[0]?.severity).toBe('critical');
  });

  it('classifies stacked or incomplete flight time blockers', () => {
    const diagnostics = classifyProductRegistrationFailure(
      'flight time source mismatch: source has round-trip flight times but saved segments are incomplete',
    );

    expect(diagnostics.map(diagnostic => diagnostic.code)).toContain('FLIGHT_TIME_MISMATCH');
  });

  it('summarizes repeated upload blockers for API responses and review queues', () => {
    const summary = summarizeProductRegistrationFailures([
      'Customer landing/A4 blocked: product_prices missing | itinerary missing',
      'Destination resolution failed: destination_code:UNK:큐슈',
    ]);

    expect(summary.hasCritical).toBe(true);
    expect(summary.codes).toEqual(expect.arrayContaining([
      'CUSTOMER_RENDER_BLOCKED',
      'PRICE_ROWS_MISSING',
      'ITINERARY_MISSING',
      'DESTINATION_UNRESOLVED',
    ]));
    expect(summary.nextAction).toMatch(/price/i);
  });
});
