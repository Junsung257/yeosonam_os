import { describe, expect, it } from 'vitest';
import { repairBlogPublishFormattingV3 } from './blog-safe-publish-repair-v3';

describe('safe publisher repair V3', () => {
  it('normalizes syntax without creating editorial content', () => {
    const source = '# 제목\r\n\r\n본문  \r\n<script>alert(1)</script>\r\n[위험](javascript:alert(1))';
    const result = repairBlogPublishFormattingV3(source);
    expect(result.markdown).toContain('# 제목\n\n본문');
    expect(result.markdown).not.toContain('<script');
    expect(result.markdown).toContain('위험');
    expect(result.markdown).not.toMatch(/FAQ|체크리스트|공식 확인|운영팀|\d{4}/);
  });

  it('does not change claims or add keywords', () => {
    const source = 'ETIAS 요금은 출처 확인 전까지 쓰지 않습니다.';
    expect(repairBlogPublishFormattingV3(source)).toMatchObject({ markdown: source, changed: false, changes: [] });
  });
});
