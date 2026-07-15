import { describe, expect, it } from 'vitest';
import {
  isAllowedBlogInformationEventOrigin,
  normalizeBlogInformationExternalUrl,
  normalizeBlogInformationInternalHref,
} from './blog-information-url-policy';

describe('blog information URL policy', () => {
  it('allows only the configured service families for commercial CTAs', () => {
    expect(normalizeBlogInformationExternalUrl({
      kind: 'NAVER_CAFE', value: 'https://cafe.naver.com/yeosonam',
    })).toBe('https://cafe.naver.com/yeosonam');
    expect(normalizeBlogInformationExternalUrl({
      kind: 'DEAL_ROOM', value: 'https://evil.example/deals',
    })).toBeNull();
    expect(normalizeBlogInformationExternalUrl({
      kind: 'CONSULTATION', value: 'https://pf.kakao.com/_verified/chat',
    })).toBe('https://pf.kakao.com/_verified/chat');
  });

  it('requires pinned provenance and a public HTTPS host for official sources', () => {
    expect(normalizeBlogInformationExternalUrl({
      kind: 'OFFICIAL_SOURCE', value: 'https://www.mofa.go.jp/entry', evidencePinnedOfficial: true,
    })).toBe('https://www.mofa.go.jp/entry');
    expect(normalizeBlogInformationExternalUrl({
      kind: 'OFFICIAL_SOURCE', value: 'https://www.mofa.go.jp/entry', evidencePinnedOfficial: false,
    })).toBeNull();
    expect(normalizeBlogInformationExternalUrl({
      kind: 'OFFICIAL_SOURCE', value: 'https://127.0.0.1/private', evidencePinnedOfficial: true,
    })).toBeNull();
  });

  it('keeps internal CTA links inside the blog surface', () => {
    expect(normalizeBlogInformationInternalHref('/blog/sapporo-weather')).toBe('/blog/sapporo-weather');
    expect(normalizeBlogInformationInternalHref('/packages/1')).toBeNull();
    expect(normalizeBlogInformationInternalHref('https://evil.example/blog/post')).toBeNull();
  });

  it('accepts same-origin event requests and rejects missing or cross-site origins', () => {
    expect(isAllowedBlogInformationEventOrigin({
      requestOrigin: 'https://www.yeosonam.com',
      originHeader: 'https://www.yeosonam.com',
      secFetchSite: 'same-origin',
    })).toBe(true);
    expect(isAllowedBlogInformationEventOrigin({
      requestOrigin: 'https://www.yeosonam.com',
      originHeader: 'https://evil.example',
      secFetchSite: 'cross-site',
    })).toBe(false);
    expect(isAllowedBlogInformationEventOrigin({
      requestOrigin: 'https://www.yeosonam.com',
    })).toBe(false);
  });
});
