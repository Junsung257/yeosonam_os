import { describe, expect, it } from 'vitest';
import {
  isLikelyOfficialBlogSourceUrl,
  isSafePublicBlogSourceUrl,
} from './blog-official-source-url';

describe('blog official source URL candidates', () => {
  it.each([
    'https://www.0404.go.kr/',
    'https://kemlu.go.id/',
    'https://travel.state.gov/content/travel.html',
    'https://worldweather.wmo.int/kr/json/1954_kr.xml',
  ])('accepts a conservative official host candidate: %s', (url) => {
    expect(isLikelyOfficialBlogSourceUrl(url)).toBe(true);
  });

  it.each([
    'https://images.pexels.com/photos/1/photo.jpg',
    'https://example.com/weather',
    'https://www.0404.go.kr.evil.example/',
    'https://www.0404.go.kr@evil.example/',
    'http://www.0404.go.kr/',
    'https://www.0404.go.kr:444/',
    'https://localhost/',
    'https://127.0.0.1/',
  ])('rejects an unsafe or non-official URL: %s', (url) => {
    expect(isLikelyOfficialBlogSourceUrl(url)).toBe(false);
  });

  it.each([
    'https://parks.canada.ca/pn-np/ab/banff',
    'https://roamtransit.com/fares/',
  ])('accepts a registry-reviewed operator URL as a safe public source: %s', (url) => {
    expect(isSafePublicBlogSourceUrl(url)).toBe(true);
  });

  it.each([
    'https://metadata.google.internal/latest',
    'https://service.local/source',
    'https://169.254.169.254/latest',
    'https://user:pass@roamtransit.com/source',
  ])('rejects a non-public research source URL: %s', (url) => {
    expect(isSafePublicBlogSourceUrl(url)).toBe(false);
  });
});
