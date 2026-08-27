import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/campaigns/launch/route.ts'), 'utf8');
}

describe('campaign launch public package boundary', () => {
  it('requires admin authorization before launch body parsing or service-role work', () => {
    const source = routeSource();
    const postIndex = source.indexOf('export async function POST');
    const postSource = source.slice(postIndex, source.indexOf('async function launchMeta'));
    const guardIndex = postSource.indexOf('await requireAdminRequest(request)');
    const bodyIndex = postSource.indexOf('request.json');
    const supabaseIndex = postSource.indexOf('supabaseAdmin');

    expect(source).toContain("from '@/lib/admin-guard'");
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(postSource.slice(guardIndex, bodyIndex)).toContain('if (authError) return authError');
    expect(bodyIndex).toBeGreaterThan(guardIndex);
    expect(supabaseIndex).toBeGreaterThan(guardIndex);
  });

  it('requires published public package snapshots before launching customer-facing ads', () => {
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

  it('keeps Meta launch-created assets in review/paused state until external confirmation', () => {
    const source = routeSource();
    const launchMetaIndex = source.indexOf('async function launchMeta');
    const launchMetaSource = source.slice(launchMetaIndex);

    expect(launchMetaSource).toContain("status: 'review'");
    expect(launchMetaSource).toContain('launched_at: null');
    expect(launchMetaSource).toContain("status: 'PAUSED'");
    expect(launchMetaSource).not.toContain("status: 'active'");
    expect(launchMetaSource).not.toContain("status: 'ACTIVE'");
  });

  it('keeps the marketing-eligible catalog gate in the shared campaign helper', () => {
    const helper = readFileSync(join(process.cwd(), 'src/lib/campaign-public-packages.ts'), 'utf8');

    expect(helper).toContain('listPublicCatalog');
    expect(helper).toContain('ids: productIds');
    expect(helper).not.toContain(".from('travel_packages')");
    expect(helper).not.toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(helper).toContain('travel_packages: publicPackagesById.get(productId) ?? null');
    expect(helper).toContain("'meta_campaign_id'");
    expect(helper).toContain("'meta_adset_id'");
    expect(helper).toContain("'meta_ad_id'");
    expect(helper).toContain("'meta_creative_id'");
  });
});
