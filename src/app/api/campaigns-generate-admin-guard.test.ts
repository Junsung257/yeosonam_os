import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('campaign creative generation authorization boundary', () => {
  it('requires admin authorization before parsing generation body or writing draft creatives', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/campaigns/generate/route.ts'), 'utf8');
    const postIndex = source.indexOf('export async function POST');
    const postSource = source.slice(postIndex);
    const guardIndex = postSource.indexOf('await requireAdminRequest(request)');
    const bodyIndex = postSource.indexOf('request.json');
    const supabaseIndex = postSource.indexOf('supabaseAdmin');
    const insertIndex = postSource.indexOf(".from('ad_creatives')");

    expect(source).toContain("from '@/lib/admin-guard'");
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(postSource.slice(guardIndex, bodyIndex)).toContain('if (authError) return authError');
    expect(bodyIndex).toBeGreaterThan(guardIndex);
    expect(supabaseIndex).toBeGreaterThan(guardIndex);
    expect(insertIndex).toBeGreaterThan(guardIndex);
  });
});
