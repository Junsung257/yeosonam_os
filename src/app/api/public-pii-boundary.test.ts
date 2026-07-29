import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function handlerSource(route: string, method: string): string {
  const start = route.indexOf(`export async function ${method}`);
  if (start < 0) return '';
  const nextHandler = route.indexOf('export async function ', start + 1);
  return route.slice(start, nextHandler < 0 ? route.length : nextHandler);
}

describe('public PII collection boundary', () => {
  it('keeps public passport OCR disabled before reading a file or calling an AI provider', () => {
    const route = source('src/app/api/passport/ocr/route.ts');

    expect(route).toContain('PASSPORT_OCR_UNAVAILABLE');
    expect(route).toContain("'Cache-Control': 'no-store'");
    expect(route).not.toContain('request.formData');
    expect(route).not.toContain('GoogleGenerativeAI');
    expect(route).not.toContain('generateContent');
  });

  it('keeps plaintext companion passport submission disabled', () => {
    const route = source('src/app/api/join/[token]/route.ts');
    const post = handlerSource(route, 'POST');

    expect(post).toContain('COMPANION_PII_COLLECTION_UNAVAILABLE');
    expect(post).toContain("'Cache-Control': 'no-store'");
    expect(post).not.toContain('request.json');
    expect(post).not.toContain("from('booking_companions')");
    expect(post).not.toContain('.update(');
  });

  it('shows safe guidance instead of public passport inputs', () => {
    const ocrPage = source('src/app/passport-assist/page.tsx');
    const companionPage = source('src/app/join/[token]/page.tsx');

    for (const page of [ocrPage, companionPage]) {
      expect(page).toContain('입력하지 마세요');
      expect(page).not.toContain('type="file"');
      expect(page).not.toContain('name="passport_no"');
    }
  });
});
