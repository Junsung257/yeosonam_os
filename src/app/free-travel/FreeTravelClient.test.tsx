import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function freeTravelClientSource() {
  return readFileSync(join(process.cwd(), 'src/app/free-travel/FreeTravelClient.tsx'), 'utf8');
}

describe('free-travel customer expectation copy', () => {
  it('does not present external free-travel links as Yeosonam direct booking', () => {
    const source = freeTravelClientSource();

    expect(source).toContain('여소남 자유여행 직접 예약·취소는 아직 열려 있지 않으니');
    expect(source).toContain('MRT에서 보기');
    expect(source).toContain('외부 예약 후보');
    expect(source).not.toContain('예약 연계</span>');
    expect(source).not.toContain('>예약</a>');
  });
});
