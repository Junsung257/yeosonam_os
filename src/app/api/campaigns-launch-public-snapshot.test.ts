import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/campaigns/launch/route.ts'), 'utf8');
}

describe('campaign launch public package boundary', () => {
  it('requires approved public package snapshots before launching customer-facing ads', () => {
    const source = routeSource();
    const creativeQueryIndex = source.indexOf(".from('ad_creatives')");
    const publicPackageIndex = source.indexOf('const launchableCreatives = await attachPublicPackagesToCampaignCreatives');
    const launchLoopIndex = source.indexOf('for (const creative of launchableCreatives)');

    expect(source).toContain('attachPublicPackagesToCampaignCreatives');
    expect(source).toContain('campaignCreativesMissingPublicPackage');
    expect(source).toContain('PUBLIC_SNAPSHOT_REQUIRED_FOR_CAMPAIGN_LAUNCH');
    expect(publicPackageIndex).toBeGreaterThan(creativeQueryIndex);
    expect(launchLoopIndex).toBeGreaterThan(publicPackageIndex);
  });

  it('does not join raw travel_packages customer fields in the launch query', () => {
    const source = routeSource();
    const postIndex = source.indexOf('export async function POST');
    const postSource = source.slice(postIndex);

    expect(postSource).not.toContain('travel_packages!inner(id, title, destination, price)');
    expect(postSource).not.toContain("select('*, travel_packages");
    expect(postSource).toContain('.select(CAMPAIGN_CREATIVE_PUBLIC_FIELDS)');
    expect(postSource).toContain('attachPublicPackagesToCampaignCreatives');
  });

  it('keeps the campaign package snapshot gate in the shared campaign helper', () => {
    const helper = readFileSync(join(process.cwd(), 'src/lib/campaign-public-packages.ts'), 'utf8');

    expect(helper).toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(helper).toContain('isCampaignPublicSnapshotCandidate');
    expect(helper).toContain('isCustomerPubliclyOpenable');
    expect(helper).toContain(".in('publication_state', ['approved', 'published'])");
    expect(helper).toContain('travel_packages: publicPackagesById.get(productId) ?? null');
  });
});
