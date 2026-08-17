import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('product registration V6 Korean visual proof contract', () => {
  it('self-hosts the Korean customer font and blocks proof when it is unavailable', () => {
    const globalCss = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    const proofSource = readFileSync(join(process.cwd(), 'src/lib/product-registration-v6/browser-proof.ts'), 'utf8');

    expect(globalCss).toContain("font-family: 'Yeosonam Korean'");
    expect(globalCss).toContain("url('/fonts/Pretendard-Regular.otf')");
    expect(globalCss).toContain("url('/fonts/Pretendard-Bold.otf')");
    expect(proofSource).toContain('await document.fonts.ready');
    expect(proofSource).toContain("failures.push('KOREAN_WEBFONT_NOT_READY')");
    expect(proofSource).toContain("screenshotState = 'customer-first-viewport-before-cta'");
    expect(proofSource).toContain("page.screenshot({ type: 'png' })");
    expect(proofSource).toContain('await page.setRequestInterception(true)');
    expect(proofSource).toContain("pathname.startsWith('/api/tracking')");
    expect(proofSource).toContain("pathname === '/api/web-vitals'");
    expect(proofSource).toContain("pathname === '/api/unmatched'");
    expect(proofSource.indexOf("screenshotState = 'customer-first-viewport-before-cta'"))
      .toBeLessThan(proofSource.indexOf('element.click();'));
  });
});
