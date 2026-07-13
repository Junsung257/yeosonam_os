import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('QA chat package context public snapshot gate', () => {
  it('loads package context through current public snapshots, not supplier raw fields', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/qa-chat-packages.ts'), 'utf8');

    expect(source).toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(source).toContain('isPublicPublicationState');
    expect(source).toContain(".in('publication_state', ['approved', 'published'])");
    expect(source).toContain('toQaCustomerPackageRows');
    expect(source).not.toContain('raw_text');
    expect(source).not.toContain('safeRawTextExcerpt');
    expect(source).not.toContain('id,title,destination,duration,nights,price,price_tiers,inclusions,excludes,itinerary');
  });

  it('keeps QA prompts on public customer copy instead of raw supplier text', () => {
    const engine = readFileSync(join(process.cwd(), 'src/lib/qa-chat-engine.ts'), 'utf8');
    const v2Route = readFileSync(join(process.cwd(), 'src/app/api/qa/chat/v2/route.ts'), 'utf8');

    expect(engine).not.toContain('safeRawTextExcerpt(p.raw_text');
    expect(engine).not.toContain('상세내용:');
    expect(engine).toContain('요약: ${p.product_summary');
    expect(engine).toContain('핵심 포인트: ${(p.product_highlights');
    expect(v2Route).toContain('product_summary: p.product_summary');
    expect(v2Route).toContain('product_highlights: p.product_highlights');
  });
});
