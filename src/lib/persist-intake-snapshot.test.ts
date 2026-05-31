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
    const maybeSingleIntake = vi.fn().mockResolvedValue({ data: { id: 'intake-existing' } });
    const eqPkg = vi.fn().mockReturnValue({ maybeSingle: maybeSingleIntake });
    const selectIntake = vi.fn().mockReturnValue({ eq: eqPkg });

    const maybeSingleQuality = vi.fn().mockResolvedValue({ data: null });
    const limitQuality = vi.fn().mockReturnValue({ maybeSingle: maybeSingleQuality });
    const orderQuality = vi.fn().mockReturnValue({ limit: limitQuality });
    const eqQuality = vi.fn().mockReturnValue({ order: orderQuality });
    const selectQuality = vi.fn().mockReturnValue({ eq: eqQuality });

    const from = vi.fn((table: string) => {
      if (table === 'ai_quality_log') return { select: selectQuality, update };
      return { select: selectIntake, update };
    });

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
    expect(result.evidenceCoverage?.total).toBeGreaterThan(0);
    expect(update).toHaveBeenCalled();
  });

  it('appends critical quality check when evidence coverage is low', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const insertSingle = vi.fn().mockResolvedValue({ data: { id: 'intake-new' }, error: null });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn().mockReturnValue({ select: insertSelect });

    const maybeSingleIntake = vi.fn().mockResolvedValue({ data: null });
    const eqPkg = vi.fn().mockReturnValue({ maybeSingle: maybeSingleIntake });
    const selectIntake = vi.fn().mockReturnValue({ eq: eqPkg });

    const maybeSingleQuality = vi.fn().mockResolvedValue({ data: { id: 'ql-1', failed_checks: [] } });
    const limitQuality = vi.fn().mockReturnValue({ maybeSingle: maybeSingleQuality });
    const orderQuality = vi.fn().mockReturnValue({ limit: limitQuality });
    const eqQuality = vi.fn().mockReturnValue({ order: orderQuality });
    const selectQuality = vi.fn().mockReturnValue({ eq: eqQuality });

    const from = vi.fn((table: string) => {
      if (table === 'ai_quality_log') return { select: selectQuality, update };
      return { select: selectIntake, insert };
    });
    const sb = { from } as unknown as Parameters<typeof persistIntakeSnapshot>[0];

    const result = await persistIntakeSnapshot(sb, {
      packageId: 'pkg-1',
      pkg: {
        title: '테스트 3박5일',
        destination: '다낭',
        duration: 5,
        nights: 3,
        raw_text: '원문은 충분히 길지만 핵심 항공편과 가격 정보는 없습니다.'.padEnd(120, '가'),
      },
      landOperatorName: '랜드부산',
      source: 'upload',
    });

    expect(result.intakeId).toBe('intake-new');
    expect(result.warnings.some(w => w.includes('sourceEvidence coverage'))).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      failed_checks: expect.arrayContaining([
        expect.objectContaining({ id: 'source_evidence_coverage_low', severity: 'critical' }),
      ]),
    }));
  });
});
