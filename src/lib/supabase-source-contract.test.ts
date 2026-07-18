import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('legacy supabase package persistence contract', () => {
  it('does not invent source-less departure airport or minimum participants', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/supabase.ts'), 'utf8');

    expect(source).not.toMatch(/departure_airport:\s*data\.departure_airport\s*\|\|/);
    expect(source).not.toMatch(/min_participants:\s*data\.min_participants\s*\|\|\s*4/);
    expect(source).toContain('departure_airport: data.departure_airport ?? null');
    expect(source).toContain('min_participants: data.min_participants ?? null');
  });
});
