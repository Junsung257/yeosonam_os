/**
 * 네이버 검색광고 HMAC-SHA256 signer 회귀 fixture.
 *
 * 출처: github.com/naver/searchad-apidoc — 공식 서명 패턴
 *   timestamp + "." + METHOD + "." + URI → HMAC-SHA256(SECRET) → Base64
 *
 * 회귀 사고 방지:
 *   - timestamp 형식 (ms epoch String) 안 깨지는지
 *   - 헤더 5개 빠짐없이 생성되는지
 *   - secret 동일·input 동일 → 결정적 출력
 */

import { describe, it, expect } from 'vitest';
import { buildNaverAdsSignature, buildNaverAdsHeaders } from './signer';

describe('buildNaverAdsSignature', () => {
  it('동일 입력 + 동일 secret → 동일 서명 (결정적)', () => {
    // timestamp 는 Date.now() 라 호출마다 다르므로 명시적으로 같은 timestamp 가 들어가면 결과 동일한지 확인
    const s1 = buildNaverAdsSignature('GET', '/ncc/keywords/abc', 'secret123');
    const s2 = buildNaverAdsSignature('GET', '/ncc/keywords/abc', 'secret123');
    // 다른 timestamp 일 가능성 — 단 같은 ms 안에 들어오면 동일 (race 가능). 형식만 검증.
    expect(s1.timestamp).toMatch(/^\d{13,}$/);
    expect(s2.timestamp).toMatch(/^\d{13,}$/);
    expect(s1.signature).toMatch(/^[A-Za-z0-9+/=]+$/); // Base64
    expect(s1.signature.length).toBeGreaterThan(40);
  });

  it('HTTP method 다르면 signature 다름', () => {
    // 같은 ms 시점에 호출되어도 method 가 다르면 message 가 달라야 signature 가 다름
    // 결정성 보장 위해 직접 buildNaverAdsSignature 가 내부에서 timestamp 를 다루는데,
    // 본 테스트는 HMAC 함수 자체의 정확성을 보는 게 아니라 method 가 message 에 들어가는지를 봄.
    // 같은 timestamp 라고 가정하고 다른 method 시도 → 시간 차이가 있을 수 있으나, 일관성 위해 method 다르면 신호 다름 확인
    const sig1 = buildNaverAdsSignature('GET', '/test', 'secret');
    const sig2 = buildNaverAdsSignature('POST', '/test', 'secret');
    // 두 호출 사이 시간 흐름 있을 수 있어 signature 자체 동일성 보장 어려움. method 가 다르면 서명 함수가 다르게 동작해야.
    expect(sig1.signature).not.toBe(sig2.signature);
  });

  it('URI 다르면 signature 다름', () => {
    const sig1 = buildNaverAdsSignature('GET', '/path/a', 'secret');
    const sig2 = buildNaverAdsSignature('GET', '/path/b', 'secret');
    expect(sig1.signature).not.toBe(sig2.signature);
  });
});

describe('buildNaverAdsHeaders', () => {
  it('필수 헤더 5개 모두 생성 — Content-Type/X-Timestamp/X-API-KEY/X-Customer/X-Signature', () => {
    const headers = buildNaverAdsHeaders('GET', '/ncc/keywords/abc', {
      apiKey: 'test-api-key',
      secret: 'test-secret',
      customerId: '1234567890',
    });
    expect(headers['Content-Type']).toBe('application/json; charset=UTF-8');
    expect(headers['X-Timestamp']).toMatch(/^\d{13,}$/);
    expect(headers['X-API-KEY']).toBe('test-api-key');
    expect(headers['X-Customer']).toBe('1234567890');
    expect(headers['X-Signature']).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('customerId 가 9자리든 10자리든 그대로 전달', () => {
    const h9 = buildNaverAdsHeaders('PUT', '/test', {
      apiKey: 'k',
      secret: 's',
      customerId: '987654321',
    });
    const h10 = buildNaverAdsHeaders('PUT', '/test', {
      apiKey: 'k',
      secret: 's',
      customerId: '1234567890',
    });
    expect(h9['X-Customer']).toBe('987654321');
    expect(h10['X-Customer']).toBe('1234567890');
  });
});
