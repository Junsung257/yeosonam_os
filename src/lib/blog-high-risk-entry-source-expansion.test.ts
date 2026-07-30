import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260730131500_expand_high_risk_entry_research_sources.sql',
  ),
  'utf8',
);

describe('high-risk entry research source expansion', () => {
  it('keeps two directly retrievable official domains for every recovery destination', () => {
    const destinationHosts: Record<string, string[]> = {
      태국: ['seoul.thaiembassy.org', 'tdac.immigration.go.th'],
      일본: ['mofa.go.jp', 'moj.go.jp'],
      베트남: ['vnembassy-seoul.mofa.gov.vn', 'evisa.immigration.gov.vn'],
      미국: ['cbp.gov', 'ecfr.gov'],
      유럽: ['home-affairs.ec.europa.eu', 'eur-lex.europa.eu'],
    };

    for (const [destination, hosts] of Object.entries(destinationHosts)) {
      expect(migration).toContain(`array['${destination}']`);
      for (const host of hosts) expect(migration).toContain(`'${host}'`);
    }
  });

  it('revokes client-shell sources instead of counting them as usable evidence', () => {
    expect(migration).toContain("status = 'revoked'");
    expect(migration).toContain('production direct-fetch returned content_too_short');
    expect(migration).toContain('https://travel-europe.europa.eu/en/etias');
    expect(migration).toContain('Article-1281?language=en_US');
    expect(migration).toContain('Article-1282?language=en_US');
  });

  it('registers only destination-scoped entry-requirement documents', () => {
    expect(migration).toContain("array['entry_requirements']");
    expect(migration).toContain('document.destinations');
    expect(migration).toContain('production direct-fetch verified 2026-07-30');
    expect(migration).toContain('title-8.xml?part=217');
    expect(migration).toContain('main-differences-between-ees-and-etias');
  });
});
