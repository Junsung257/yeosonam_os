import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260730152500_add_retrievable_entry_authorities.sql'),
  'utf8',
);

describe('retrievable entry authority migration', () => {
  it('registers destination-scoped official Japan and US documents', () => {
    expect(migration).toContain("'kr.emb-japan.go.jp'");
    expect(migration).toContain("'dhs.gov'");
    expect(migration).toContain('https://www.kr.emb-japan.go.jp/itpr_ko/visa_application.html');
    expect(migration).toContain('https://www.dhs.gov/visa-waiver-program-and-guam-cnmi-visa-waiver-program');
    expect(migration).toContain("array['entry_requirements']");
    expect(migration).toContain("array['일본']");
    expect(migration).toContain("array['미국']");
  });
});
