import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { extractHwpxText } from './hwpx-text';

async function buildHwpxBuffer(sectionXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('Contents/section0.xml', sectionXml);
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

describe('extractHwpxText', () => {
  it('extracts Korean supplier text from HWPX section XML', async () => {
    const buffer = await buildHwpxBuffer([
      '<hp:sec>',
      '<hp:p><hp:run><hp:t>출발일 7월16일</hp:t></hp:run></hp:p>',
      '<hp:p><hp:run><hp:t>성인 1,529,000원</hp:t></hp:run></hp:p>',
      '<hp:p><hp:run><hp:t>DAY 1 연길 도착 후 가이드 미팅</hp:t></hp:run></hp:p>',
      '</hp:sec>',
    ].join(''));

    const text = await extractHwpxText(buffer, 'sample.hwpx');

    expect(text).toContain('출발일 7월16일');
    expect(text).toContain('성인 1,529,000원');
    expect(text).toContain('DAY 1 연길 도착 후 가이드 미팅');
  });

  it('fails loudly when the HWPX package has no body sections', async () => {
    const zip = new JSZip();
    zip.file('version.xml', '<version />');
    const buffer = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));

    await expect(extractHwpxText(buffer, 'empty.hwpx')).rejects.toThrow('section XML');
  });
});
