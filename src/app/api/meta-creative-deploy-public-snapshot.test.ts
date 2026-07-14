import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/meta/creatives/deploy/route.ts'), 'utf8');
}

describe('Meta creative deploy public package boundary', () => {
  it('requires a current public package snapshot before deploying a customer-facing Meta creative', () => {
    const source = routeSource();
    const creativeQueryIndex = source.indexOf(".from('ad_creatives')");
    const attachIndex = source.indexOf('const [deployableCreative] = await attachPublicPackagesToCampaignCreatives');
    const uploadIndex = source.indexOf('const metaCreative = await uploadCreativeToMeta');

    expect(source).toContain('attachPublicPackagesToCampaignCreatives');
    expect(source).toContain('CAMPAIGN_CREATIVE_PUBLIC_FIELDS');
    expect(source).toContain('PUBLIC_SNAPSHOT_REQUIRED_FOR_META_CREATIVE_DEPLOY');
    expect(attachIndex).toBeGreaterThan(creativeQueryIndex);
    expect(uploadIndex).toBeGreaterThan(attachIndex);
  });

  it('does not trust raw creative joins or caller-provided package URLs for Meta deploy', () => {
    const source = routeSource();

    expect(source).not.toContain(".select('*')");
    expect(source).not.toContain('travel_packages(');
    expect(source).not.toContain('package_url');
    expect(source).toContain('const targetUrl =');
    expect(source).toContain('/packages/${pkg.id}');
  });
});
