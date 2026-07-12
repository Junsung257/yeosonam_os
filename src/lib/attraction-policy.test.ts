import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { canCreateAttractionRecord, shouldAllowAutoAttractionInsert } from './attraction-policy';

describe('attraction-policy SSOT', () => {
  it('denies auto insert by default', () => {
    expect(shouldAllowAutoAttractionInsert({})).toBe(false);
    expect(shouldAllowAutoAttractionInsert({ nodeEnv: 'production', allowAutoAttractionInsertEnv: '1' })).toBe(false);
    expect(shouldAllowAutoAttractionInsert({ nodeEnv: 'development', allowAutoAttractionInsertEnv: '1' })).toBe(false);
  });

  it('denies auto insert even in test with explicit opt-in', () => {
    expect(shouldAllowAutoAttractionInsert({ nodeEnv: 'test', allowAutoAttractionInsertEnv: '1' })).toBe(false);
    expect(shouldAllowAutoAttractionInsert({ nodeEnv: 'test', allowAutoAttractionInsertEnv: '0' })).toBe(false);
  });

  it('allows creation only for admin manual channel', () => {
    expect(canCreateAttractionRecord('admin_manual')).toBe(true);
    expect(canCreateAttractionRecord('cron')).toBe(false);
    expect(canCreateAttractionRecord('upload', { nodeEnv: 'production', allowAutoAttractionInsertEnv: '1' })).toBe(false);
    expect(canCreateAttractionRecord('upload', { nodeEnv: 'test', allowAutoAttractionInsertEnv: '1' })).toBe(false);
  });

  it('keeps the upload registration pipeline free of attraction inserts', () => {
    const uploadRoute = readFileSync(path.join(process.cwd(), 'src/app/api/upload/route.ts'), 'utf8');
    const unmatchedQueue = readFileSync(path.join(process.cwd(), 'src/lib/product-registration/unmatched-queue.ts'), 'utf8');

    expect(uploadRoute).not.toMatch(/from\(['"]attractions['"]\)\s*\.\s*insert/);
    expect(uploadRoute).not.toContain('ALLOW_AUTO_ATTRACTION_INSERT');
    expect(unmatchedQueue).toContain('queueUploadAttractionReviewCandidates');
    expect(unmatchedQueue).toContain("from('unmatched_activities').upsert");
    expect(unmatchedQueue).not.toMatch(/from\(['"]attractions['"]\)\s*\.\s*insert/);
  });

  it('blocks AI or paste-derived attraction cards from direct master creation', () => {
    const attractionRoute = readFileSync(path.join(process.cwd(), 'src/app/api/attractions/route.ts'), 'utf8');
    const adminAttractionsPage = readFileSync(path.join(process.cwd(), 'src/app/admin/attractions/page.tsx'), 'utf8');

    expect(attractionRoute).toContain("sourceLevel !== 'manual'");
    expect(attractionRoute).toContain('ATTRACTION_CREATION_REQUIRES_DIRECT_MANUAL_ENTRY');
    expect(adminAttractionsPage).toContain('AI 파싱 후보의 신규 관광지 일괄 등록은 차단되었습니다.');
    expect(adminAttractionsPage).toContain('검수 후 직접 등록');
  });
});
