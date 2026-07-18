import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { looksLikePlainTextBuffer, shouldTreatDocumentAsPlainText } from './parser';

describe('parser file type detection', () => {
  it('accepts extensionless pasted text filenames as plain text', () => {
    const raw = `PKG
이라크 골프 3박5일
출발일
6/20,21,28
999,-
`;

    const buffer = Buffer.from(raw.repeat(5), 'utf8');

    expect(looksLikePlainTextBuffer(buffer)).toBe(true);
    expect(shouldTreatDocumentAsPlainText(buffer, '3박5일')).toBe(true);
  });

  it('accepts markdown text as plain text input', () => {
    const buffer = Buffer.from('# 상품명\n다낭 3박5일\n'.repeat(5), 'utf8');

    expect(shouldTreatDocumentAsPlainText(buffer, '상품.md')).toBe(true);
  });

  it('does not treat binary-like buffers as extensionless text', () => {
    const buffer = Buffer.from([0, 1, 2, 3, 4, 5, 255, 0, 9, 10]);

    expect(looksLikePlainTextBuffer(buffer)).toBe(false);
    expect(shouldTreatDocumentAsPlainText(buffer, '3박5일')).toBe(false);
  });
  it('does not invent a default minimum participant count when the source is silent', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/parser.ts'), 'utf8');

    expect(source).not.toContain('없으면 4');
    expect(source).not.toMatch(/min_participants:\s*parsed\.min_participants\s*\|\|\s*4/);
    expect(source).not.toMatch(/min_participants:\s*typeof item\.min_participants === 'number' \? item\.min_participants : 4/);
    expect(source).toContain('"min_participants": 최소출발인원 숫자 (원문에 없으면 null)');
  });
});
