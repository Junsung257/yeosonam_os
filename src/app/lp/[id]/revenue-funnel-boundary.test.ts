import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('one-offer landing revenue boundary', () => {
  const landing = fs.readFileSync(
    path.join(process.cwd(), 'src/app/lp/[id]/LandingClient.tsx'),
    'utf8',
  );
  const loader = fs.readFileSync(path.join(process.cwd(), 'src/lib/load-lp-package.ts'), 'utf8');
  const mapper = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/map-travel-package-to-lp.ts'),
    'utf8',
  );

  it('reads a customer offer only through the approved public snapshot boundary', () => {
    expect(loader).toContain('fetchLatestPublicPackageSnapshot');
    expect(loader).toContain('if (!options.allowNonPublicProof && !publicSnapshot) return null');
    expect(loader).toContain('isPublicPublicationState');
  });

  it('persists the Kakao attribution event before opening the external channel', () => {
    const clickStart = landing.indexOf("eventType: 'kakao_clicked'");
    const awaitedPersistence = landing.lastIndexOf('await Promise.race', clickStart);
    const channelOpen = landing.indexOf('await openKakaoChannel', clickStart);
    expect(clickStart).toBeGreaterThan(-1);
    expect(awaitedPersistence).toBeGreaterThan(-1);
    expect(channelOpen).toBeGreaterThan(clickStart);
    expect(awaitedPersistence).toBeLessThan(clickStart);
  });

  it('does not contain unsupported direct-lowest-price or popularity claims', () => {
    expect(landing).not.toContain('직판<br />최저가');
    expect(mapper).not.toContain('상담 문의가 많습니다');
  });
});
