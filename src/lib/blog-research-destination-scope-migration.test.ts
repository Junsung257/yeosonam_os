import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('reviewed research document destination-scope migration', () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      'supabase/migrations/20260728173000_blog_research_document_destination_scopes.sql',
    ),
    'utf8',
  );

  it('backfills WMO rows from their reviewed destination note', () => {
    expect(source).toContain("registry.hostname = 'worldweather.wmo.int'");
    expect(source).toContain("SET destinations = ARRAY[");
    expect(source).toContain("document.review_note ~ ' for .+\\.$'");
  });

  it('scopes the Cebu and Bohol PAGASA station documents separately', () => {
    expect(source).toContain("ARRAY['세부', 'cebu']");
    expect(source).toContain("'%/MACTAN.pdf'");
    expect(source).toContain("ARRAY['보홀', 'bohol']");
    expect(source).toContain("'%/TAGBILARAN-DAUIS.pdf'");
  });
});
