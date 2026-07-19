import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  normalizeJsonLdText,
  normalizeJsonLdUrl,
  serializeJsonLdForScript,
} from '@/lib/json-ld';

const hostile = {
  headline: '</script><script>globalThis.__jsonLdXss=1</script>',
  description: '<img src=x onerror=alert(1)> & <!--',
  author: { name: '운영팀\u2028<script>alert(2)</script>\u2029' },
  breadcrumb: [{ name: '</script><!--' }],
};

describe('serializeJsonLdForScript', () => {
  it('round-trips hostile nested values without emitting script-breaking text', () => {
    const serialized = serializeJsonLdForScript(hostile);

    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<script');
    expect(serialized).not.toContain('<img');
    expect(serialized).not.toContain('<!--');
    expect(serialized).not.toContain('\u2028');
    expect(serialized).not.toContain('\u2029');
    expect(JSON.parse(serialized)).toEqual(hostile);
  });

  it('keeps a React-rendered JSON-LD script inert', () => {
    const html = renderToStaticMarkup(
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLdForScript(hostile) }}
      />,
    );

    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
    expect(html).not.toContain('</script><script>');
    expect(html).not.toContain('<!--');
  });

  it('preserves ordinary structured data', () => {
    const value = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: '오사카 여행' };
    expect(JSON.parse(serializeJsonLdForScript(value))).toEqual(value);
  });

  it('removes dangerous URL protocols from URL fields', () => {
    const serialized = serializeJsonLdForScript({
      '@context': 'https://schema.org',
      url: 'javascript:alert(1)',
      image: 'data:image/svg+xml,<svg onload=alert(1)>',
    });

    expect(JSON.parse(serialized)).toEqual({
      '@context': 'https://schema.org',
      url: '',
      image: '',
    });
  });

  it('rejects values that JSON.stringify cannot represent as a document', () => {
    expect(() => serializeJsonLdForScript(undefined)).toThrow(TypeError);
  });
});

describe('JSON-LD value normalization', () => {
  it('allows HTTPS and same-origin URLs while rejecting executable or credentialed URLs', () => {
    const origin = 'https://www.yeosonam.com';

    expect(normalizeJsonLdUrl('https://www.yeosonam.com/blog/osaka', {
      fallback: null,
      allowedOrigin: origin,
    })).toBe('https://www.yeosonam.com/blog/osaka');
    expect(normalizeJsonLdUrl('javascript:alert(1)', { fallback: null })).toBeNull();
    expect(normalizeJsonLdUrl('data:text/html,<script>alert(1)</script>', { fallback: null })).toBeNull();
    expect(normalizeJsonLdUrl('https://user:pass@www.yeosonam.com/blog', { fallback: null })).toBeNull();
    expect(normalizeJsonLdUrl('https://evil.example/blog', {
      fallback: null,
      allowedOrigin: origin,
    })).toBeNull();
  });

  it('bounds text and removes disallowed control characters', () => {
    expect(normalizeJsonLdText('  abc\u0000def  ', 6)).toBe('abcdef');
    expect(normalizeJsonLdText('123456789', 5)).toBe('12345');
    expect(normalizeJsonLdText(123, 5, 'fallback')).toBe('fallback');
  });
});
