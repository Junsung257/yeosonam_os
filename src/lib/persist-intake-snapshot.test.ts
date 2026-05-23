import { describe, expect, it, vi } from 'vitest';
import { persistIntakeSnapshot } from './persist-intake-snapshot';

describe('persistIntakeSnapshot', () => {
  it('skips when raw_text is too short', async () => {
    const sb = { from: vi.fn() } as unknown as Parameters<typeof persistIntakeSnapshot>[0];
    const result = await persistIntakeSnapshot(sb, {
      packageId: 'pkg-1',
      pkg: { title: '테스트', raw_text: '짧음' },
      landOperatorName: '랜드부산',
      source: 'upload',
    });
    expect(result.intakeId).toBeNull();
    expect(result.warnings.some(w => w.includes('raw_text'))).toBe(true);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('updates existing intake by package_id', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'intake-existing' } });
    const eqPkg = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq: eqPkg });
    const from = vi.fn().mockReturnValue({ select, update });

    const sb = { from } as unknown as Parameters<typeof persistIntakeSnapshot>[0];
    const raw = 'PKG\n테스트 상품 3박5일\n'.padEnd(120, '가');

    const result = await persistIntakeSnapshot(sb, {
      packageId: 'pkg-1',
      pkg: {
        title: '테스트 3박5일',
        destination: '다낭',
        country: '베트남',
        duration: 5,
        nights: 3,
        inclusions: ['항공료'],
        excludes: ['개인경비'],
        raw_text: raw,
        commission_rate: 9,
      },
      landOperatorName: '랜드부산',
      source: 'upload',
    });

    expect(result.intakeId).toBe('intake-existing');
    expect(result.created).toBe(false);
    expect(update).toHaveBeenCalled();
  });
});
