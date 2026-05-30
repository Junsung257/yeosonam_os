import { describe, expect, it } from 'vitest';
import {
  buildQaPackageHintSource,
  extractQaDestinationHint,
  QA_KNOWN_DESTINATION_KEYWORDS,
} from './qa-destination-hint';

const K = {
  danang: '\uB2E4\uB0AD',
  vietnam: '\uBCA0\uD2B8\uB0A8',
  bohol: '\uBCF4\uD640',
  philippines: '\uD544\uB9AC\uD540',
  osaka: '\uC624\uC0AC\uCE74',
  japan: '\uC77C\uBCF8',
  guilin: '\uACC4\uB9BC',
  china: '\uC911\uAD6D',
  hongkong: '\uD64D\uCF69',
} as const;

describe('extractQaDestinationHint', () => {
  it('returns the first known destination keyword in the message', () => {
    expect(extractQaDestinationHint(`5\uC6D4\uC5D0 ${K.danang} \uAC00\uACE0 \uC2F6\uC5B4`)).toBe(K.danang);
    expect(extractQaDestinationHint(`${K.osaka} 3\uBC15 4\uC77C`)).toBe(K.osaka);
  });

  it('returns aliases for country-level keywords', () => {
    expect(extractQaDestinationHint(`${K.vietnam} \uC790\uC720\uC5EC\uD589`)).toBe(K.danang);
    expect(extractQaDestinationHint(`${K.japan} \uD328\uD0A4\uC9C0`)).toBe(K.osaka);
    expect(extractQaDestinationHint(`${K.china} \uD6A8\uB3C4\uC5EC\uD589`)).toBe(K.guilin);
  });

  it('returns null when no destination exists', () => {
    expect(extractQaDestinationHint('\uCD94\uCC9C \uC880 \uD574\uC918')).toBeNull();
    expect(extractQaDestinationHint('')).toBeNull();
  });

  it('all registered keywords can be detected', () => {
    const aliases: Record<string, string> = {
      [K.vietnam]: K.danang,
      [K.philippines]: K.bohol,
      [K.japan]: K.osaka,
      [K.china]: K.guilin,
    };
    for (const dest of QA_KNOWN_DESTINATION_KEYWORDS) {
      expect(extractQaDestinationHint(`${dest} \uC5EC\uD589`)).toBe(aliases[dest] ?? dest);
    }
  });
});

describe('buildQaPackageHintSource', () => {
  it('combines the current message and recent user messages', () => {
    const history = [
      { role: 'user', content: '\uC548\uB155' },
      { role: 'assistant', content: '\uBB34\uC5C7\uC744 \uB3C4\uC640\uB4DC\uB9B4\uAE4C\uC694' },
      { role: 'user', content: `${K.danang}\uC774 \uAD81\uAE08\uD574` },
    ];
    const src = buildQaPackageHintSource('\uAC00\uACA9\uB300\uB294 \uC5BC\uB9C8\uC57C?', history);
    expect(src).toContain('\uAC00\uACA9\uB300\uB294 \uC5BC\uB9C8\uC57C?');
    expect(src).toContain(`${K.danang}\uC774 \uAD81\uAE08\uD574`);
    expect(extractQaDestinationHint(src)).toBe(K.danang);
  });

  it('uses only message when history is empty', () => {
    expect(buildQaPackageHintSource(`  ${K.hongkong}  `, [])).toBe(K.hongkong);
  });
});
