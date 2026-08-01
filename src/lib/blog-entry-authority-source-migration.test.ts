import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260730152500_add_retrievable_entry_authorities.sql'),
  'utf8',
);
const usPurposeMigration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260801152219_add_us_vwp_purpose_authority.sql'),
  'utf8',
);
const usEntryContractMigration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260801163651_add_us_entry_supporting_and_customs_authority.sql'),
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

describe('US VWP purpose authority migration', () => {
  it('registers destination-scoped DHS purpose and stay guidance', () => {
    expect(usPurposeMigration).toContain("'dhs.gov'");
    expect(usPurposeMigration).toContain('https://www.dhs.gov/visa-waiver-program');
    expect(usPurposeMigration).toContain("array['entry_requirements']");
    expect(usPurposeMigration).toContain("array['미국']");
  });
});

describe('US complete entry contract authority migration', () => {
  it('registers retrievable supporting-document and customs guidance', () => {
    expect(usEntryContractMigration).toContain("'overseas.mofa.go.kr', 'embassy'");
    expect(usEntryContractMigration).toContain("'cbp.gov', 'customs'");
    expect(usEntryContractMigration).toContain('https://overseas.mofa.go.kr/us-seattle-ko/brd/m_4733/view.do?seq=1342928');
    expect(usEntryContractMigration).toContain('https://www.cbp.gov/travel/us-citizens/know-before-you-go/know-you-go-traveling-abroad');
    expect(usEntryContractMigration).not.toContain('help.cbp.gov');
    expect(usEntryContractMigration).not.toContain('esta.cbp.dhs.gov/faq');
    expect(usEntryContractMigration).toContain("array['entry_requirements']");
    expect(usEntryContractMigration).toContain("array['미국']");
  });
});
