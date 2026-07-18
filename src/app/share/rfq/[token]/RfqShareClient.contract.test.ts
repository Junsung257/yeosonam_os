import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('RFQ share page owner-action contract', () => {
  it('is read-only and does not expose the administrator-only select endpoint', () => {
    const source = readFileSync(new URL('./RfqShareClient.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('/select');
    expect(source).not.toContain('selectProposal');
    expect(source).not.toContain('이 제안으로 진행');
    expect(source).toContain('관리자 확인 중입니다.');
  });
});
