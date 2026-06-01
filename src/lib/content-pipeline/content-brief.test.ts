import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { prepareCustomerMarketingBriefInput } from './content-brief';

describe('content brief customer remark safety', () => {
  const rawSupplierRemark = '전체 일정 및 식사 순서는 현지 사정에 의해 다소 변경될 수 있습니다.';

  it('removes supplier special_notes before customer-facing brief generation', () => {
    const safeInput = prepareCustomerMarketingBriefInput({
      mode: 'product',
      slideCount: 6,
      product: {
        title: '나트랑 달랏 3박5일',
        destination: '나트랑',
        product_summary: '여소남 표준 요약',
        special_notes: rawSupplierRemark,
      },
    });

    expect(safeInput.product?.special_notes).toBeUndefined();
    expect(JSON.stringify(safeInput)).not.toContain(rawSupplierRemark);
  });

  it('does not feed travel_packages.special_notes into card-news customer copy routes', () => {
    const repoRoot = process.cwd();
    const routeSource = readFileSync(path.join(repoRoot, 'src/app/api/card-news/route.ts'), 'utf8');
    const campaignSource = readFileSync(path.join(repoRoot, 'src/app/api/card-news/campaign/route.ts'), 'utf8');

    expect(routeSource).not.toContain('.select(\'product_summary, special_notes');
    expect(routeSource).not.toContain('pkg.special_notes');
    expect(campaignSource).not.toContain('product_summary, special_notes');
    expect(campaignSource).not.toContain('special_notes: pkgRow.special_notes');
  });

  it('does not feed supplier remarks into marketing prompt or creative parser inputs', () => {
    const repoRoot = process.cwd();
    const promptSource = readFileSync(path.join(repoRoot, 'src/components/admin/MarketingPromptGenerator.tsx'), 'utf8');
    const creativeParserSource = readFileSync(path.join(repoRoot, 'src/lib/creative-engine/parse-product.ts'), 'utf8');
    const aiAnalystSource = readFileSync(path.join(repoRoot, 'src/lib/ai-analyst.ts'), 'utf8');

    expect(promptSource).not.toContain('### 유의사항\\n${pkg.special_notes}');
    expect(creativeParserSource).not.toContain('product_summary, special_notes');
    expect(creativeParserSource).not.toContain('특이사항: ${pkg.special_notes}');
    expect(creativeParserSource).not.toContain('pkg.product_summary, pkg.special_notes');
    expect(aiAnalystSource).not.toContain('${pkg.special_notes');
  });

  it('does not select supplier special_notes in customer content distribution APIs', () => {
    const repoRoot = process.cwd();
    const generateAllSource = readFileSync(path.join(repoRoot, 'src/app/api/content/generate-all/route.ts'), 'utf8');
    const autoPublishSource = readFileSync(path.join(repoRoot, 'src/app/api/orchestrator/auto-publish/route.ts'), 'utf8');
    const b2bDetailSource = readFileSync(path.join(repoRoot, 'src/app/api/b2b/packages/[id]/route.ts'), 'utf8');

    expect(generateAllSource).not.toContain('itinerary, special_notes');
    expect(autoPublishSource).not.toContain('product_highlights, special_notes');
    expect(autoPublishSource).not.toContain('special_notes: product.special_notes');
    expect(b2bDetailSource).not.toContain('itinerary_data, special_notes');
  });

  it('strips supplier remarks from the mixed public packages API response', () => {
    const repoRoot = process.cwd();
    const packagesRouteSource = readFileSync(path.join(repoRoot, 'src/app/api/packages/route.ts'), 'utf8');

    expect(packagesRouteSource).toContain('function stripSupplierRemarkFields');
    expect(packagesRouteSource).toContain('package: stripSupplierRemarkFields');
    expect(packagesRouteSource).toContain('...stripSupplierRemarkFields(row)');
  });
});
