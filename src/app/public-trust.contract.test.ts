import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('customer trust contract', () => {
  it('contains no mock activity, unsupported volume/SLA claims, placeholder registration or old domain', () => {
    const customerSources = [
      'src/app/page.tsx',
      'src/app/private-tour/page.tsx',
      'src/app/private-tour/PrivateTourLandingClient.tsx',
      'src/app/group/page.tsx',
      'src/app/about/page.tsx',
    ].map(source).join('\n');
    for (const forbidden of [
      'MOCK_FEED',
      '120+',
      '24시간 내',
      '방금 전',
      '000-00-00000',
      '제2024-000000호',
      'yeosonam.co.kr',
      '출발 보장',
      '안전 결제',
    ]) {
      expect(customerSources).not.toContain(forbidden);
    }
  });

  it('uses the approved business navigation and real internal legal routes', () => {
    const nav = source('src/components/customer/GlobalNav.tsx');
    const tabs = source('src/components/customer/BottomTabBar.tsx');
    const home = source('src/app/page.tsx');
    for (const label of ['패키지', '크루즈', '해외골프', '단독·단체', '여행가이드']) {
      expect(nav).toContain(label);
    }
    for (const label of ['홈', '상품찾기', '실시간견적', '카카오', '내 여행']) {
      expect(tabs).toContain(label);
    }
    expect(home).toContain('href="/terms"');
    expect(home).toContain('href="/privacy"');
    expect(home).not.toContain('/disclaimer');
  });
});
