import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/campaigns/creatives/route.ts'), 'utf8');
}

describe('campaign creatives public package boundary', () => {
  it('requires admin authorization before listing or mutating campaign creatives', () => {
    const source = routeSource();
    const getIndex = source.indexOf('export async function GET');
    const patchIndex = source.indexOf('export async function PATCH');
    const getSource = source.slice(getIndex, patchIndex);
    const patchSource = source.slice(patchIndex);

    expect(source).toContain("from '@/lib/admin-guard'");
    expect(getSource.indexOf('await requireAdminRequest(request)')).toBeGreaterThanOrEqual(0);
    expect(patchSource.indexOf('await requireAdminRequest(request)')).toBeGreaterThanOrEqual(0);
    expect(getSource.indexOf('isSupabaseConfigured')).toBeGreaterThan(getSource.indexOf('await requireAdminRequest(request)'));
    expect(patchSource.indexOf('isSupabaseConfigured')).toBeGreaterThan(patchSource.indexOf('await requireAdminRequest(request)'));
  });

  it('returns campaign creatives with package data only after public snapshot attachment', () => {
    const source = routeSource();
    const queryIndex = source.indexOf(".from('ad_creatives')");
    const attachIndex = source.indexOf('const creatives = await attachPublicPackagesToCampaignCreatives');
    const responseIndex = source.indexOf('return NextResponse.json({\n    creatives: creatives.filter');

    expect(source).toContain('attachPublicPackagesToCampaignCreatives');
    expect(source).toContain('CAMPAIGN_CREATIVE_PUBLIC_FIELDS');
    expect(attachIndex).toBeGreaterThan(queryIndex);
    expect(responseIndex).toBeGreaterThan(attachIndex);
  });

  it('does not join raw travel package customer fields in the creative list query', () => {
    const source = routeSource();
    const getIndex = source.indexOf('export async function GET');
    const patchIndex = source.indexOf('export async function PATCH');
    const getSource = source.slice(getIndex, patchIndex);

    expect(getSource).not.toContain('travel_packages!inner(id, title, destination)');
    expect(getSource).not.toContain("select('*, travel_packages");
    expect(getSource).toContain('.select(CAMPAIGN_CREATIVE_PUBLIC_FIELDS)');
    expect(getSource).toContain('creatives.filter((creative) => creative.travel_packages)');
  });

  it('does not allow direct active status changes without a provider confirmation path', () => {
    const source = routeSource();

    expect(source).toContain("const validStatuses = ['draft', 'review', 'paused', 'ended']");
    expect(source).not.toContain("const validStatuses = ['draft', 'review', 'active', 'paused', 'ended']");
  });
});
