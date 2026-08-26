import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('legacy supabase package persistence contract', () => {
  it('retires the mutable travel package writer fail-closed', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/supabase.ts'), 'utf8');
    const writerStart = source.indexOf('export async function saveTravelPackage');
    const writerEnd = source.indexOf('// 여행 상품 수정', writerStart);
    const writer = source.slice(writerStart, writerEnd);

    expect(source).not.toMatch(/departure_airport:\s*data\.departure_airport\s*\|\|/);
    expect(source).not.toMatch(/min_participants:\s*data\.min_participants\s*\|\|\s*4/);
    expect(writerStart).toBeGreaterThanOrEqual(0);
    expect(writerEnd).toBeGreaterThan(writerStart);
    expect(writer).toContain('LEGACY_PACKAGE_WRITER_RETIRED_USE_REGISTRATION_KERNEL');
    expect(writer).toContain('throw new Error');
    expect(writer).not.toContain(".from('travel_packages')");
    expect(writer).not.toContain('.insert(');
    expect(source).toContain('LEGACY_PACKAGE_WRITER_RETIRED_USE_REGISTRATION_KERNEL');
    expect(source).toContain('LEGACY_PACKAGE_WRITER_RETIRED_USE_CORRECTION_REVISION');
  });
});
