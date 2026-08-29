import { describe, expect, it } from 'vitest';
import {
  sanitizePublicBlogBodyHtml,
  stripPublicDuplicateBodyTitleHeading,
} from './blog-public-render-normalizer';

describe('public blog render normalizer', () => {
  it('keeps the page title as the only possible H1 and removes executable markup', () => {
    const html = sanitizePublicBlogBodyHtml('<h1>본문 제목</h1><script>alert(1)</script><p onclick="x()">답변</p>');
    expect(html).toContain('<h2>본문 제목</h2>');
    expect(html).not.toMatch(/<h1\b|<script|onclick=/i);
  });

  it('removes only exact repeated long blocks and excessive horizontal rules', () => {
    const repeated = '동일한 긴 고객 문단은 공개 본문에서 한 번만 보여야 하며 숫자나 의미가 다른 문장은 유지해야 합니다.';
    const html = sanitizePublicBlogBodyHtml(
      `<p>${repeated}</p><hr><hr><hr><p>${repeated}</p><p>${repeated} 추가 정보</p>`,
    );

    expect(html.match(new RegExp(repeated, 'g'))).toHaveLength(2);
    expect(html).toContain(`${repeated} 추가 정보`);
    expect(html).not.toContain('<hr');
  });

  it('preserves a small number of intentional horizontal rules', () => {
    const html = sanitizePublicBlogBodyHtml('<p>첫 구간입니다.</p><hr><p>둘째 구간입니다.</p><hr>');

    expect(html.match(/<hr/g)).toHaveLength(2);
  });

  it('makes non-descriptive legacy image labels decorative without inventing a scene', () => {
    const html = sanitizePublicBlogBodyHtml(
      '<img src="/generic.jpg" alt="후쿠오카 10초 판단">'
      + '<img src="/real.jpg" alt="후쿠오카 모모치 해변과 후쿠오카 타워">',
    );

    expect(html).toContain('src="/generic.jpg" alt=""');
    expect(html).toContain('src="/real.jpg" alt="후쿠오카 모모치 해변과 후쿠오카 타워"');
  });

  it('restores a descriptive fallback alt from the destination and nearest section', () => {
    const html = sanitizePublicBlogBodyHtml(
      '<h2>10초 판단</h2><p><img src="/generic.jpg" alt=""></p>',
      { imageAltPrefix: '후쿠오카' },
    );

    expect(html).toContain('alt="후쿠오카 10초 판단 이미지"');
  });

  it('removes only a leading body heading that repeats the page title', () => {
    expect(
      stripPublicDuplicateBodyTitleHeading(
        '<h2 id="same">몽골 여행 준비 가이드</h2><p>본문</p>',
        '몽골 여행 준비 가이드 | 여소남',
      ),
    ).toBe('<p>본문</p>');
    expect(
      stripPublicDuplicateBodyTitleHeading(
        '<h2 id="different">출발 전 체크</h2><p>본문</p>',
        '몽골 여행 준비 가이드',
      ),
    ).toContain('출발 전 체크');
  });
});
