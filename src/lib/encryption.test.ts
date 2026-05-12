/**
 * encryption 단위 테스트
 *
 * 보안 critical — 계좌번호/사업자번호 등 PII 저장 시 사용 (AES-256-GCM).
 * 회귀 위험:
 *   - encrypt → decrypt 라운드트립 깨지면 결제 정보 영구 손실
 *   - maskBankInfo 가 너무 많이 노출하면 PII 유출
 *
 * 테스트 환경: ENCRYPTION_SECRET_KEY 자동 주입 (랜덤 32바이트)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import { encrypt, decrypt, maskBankInfo, maskEncryptedBankInfo } from './encryption';

beforeAll(() => {
  // 테스트 전용 고정 키 (각 테스트가 같은 키 사용 → encrypt/decrypt 라운드트립 검증 가능)
  process.env['ENCRYPTION_SECRET_KEY'] = crypto.randomBytes(32).toString('hex');
});

describe('encrypt → decrypt 라운드트립', () => {
  it('단순 ASCII 라운드트립', () => {
    const plain = '110-123-456789';
    const enc = encrypt(plain);
    expect(decrypt(enc)).toBe(plain);
  });

  it('한글 평문 라운드트립', () => {
    const plain = '신한은행 110-123-456789 홍길동';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('빈 문자열 라운드트립', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('긴 텍스트 라운드트립 (10KB)', () => {
    const plain = 'A'.repeat(10_000);
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('출력 형식: "iv:authTag:ciphertext" (3 파트, 모두 hex)', () => {
    const enc = encrypt('test');
    const parts = enc.split(':');
    expect(parts).toHaveLength(3);
    for (const p of parts) {
      expect(p).toMatch(/^[0-9a-f]+$/); // hex only
    }
  });

  it('동일 평문도 매번 다른 ciphertext (IV 랜덤)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b); // IV 다르면 출력 다름
    expect(decrypt(a)).toBe('same');
    expect(decrypt(b)).toBe('same');
  });
});

describe('decrypt 보안 가드', () => {
  it('형식 깨진 입력 → throw', () => {
    expect(() => decrypt('invalid')).toThrow();
    expect(() => decrypt('a:b')).toThrow(); // 2 파트만
  });

  it('변조된 ciphertext → throw (auth tag mismatch)', () => {
    const enc = encrypt('original');
    const [iv, tag, ct] = enc.split(':');
    // ciphertext 마지막 글자 변조
    const tampered = `${iv}:${tag}:${ct.slice(0, -2)}ff`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('변조된 IV → throw', () => {
    const enc = encrypt('original');
    const [iv, tag, ct] = enc.split(':');
    const ivLen = iv.length;
    const tampered = `${'00'.repeat(ivLen / 2)}:${tag}:${ct}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('변조된 auth tag → throw', () => {
    const enc = encrypt('original');
    const [iv, tag, ct] = enc.split(':');
    const tagLen = tag.length;
    const tampered = `${iv}:${'00'.repeat(tagLen / 2)}:${ct}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe('maskBankInfo — PII 노출 최소화', () => {
  it('하이픈 3 파트 → 마지막만 노출', () => {
    expect(maskBankInfo('110-123-456789')).toBe('***-***-456789');
  });

  it('하이픈 없음, 길이 > 4 → 뒤 4자리만 노출', () => {
    expect(maskBankInfo('1101234567890')).toBe('*********7890');
  });

  it('짧은 입력 (≤4) → 그대로 (가릴 의미 없음)', () => {
    expect(maskBankInfo('1234')).toBe('1234');
  });

  it('빈 입력 → "****"', () => {
    expect(maskBankInfo('')).toBe('****');
  });

  it('숫자/하이픈 외 문자는 제거', () => {
    expect(maskBankInfo('110-123-456789 (홍길동)')).toBe('***-***-456789');
  });

  it('하이픈 4 파트도 처리 (마지막만 노출)', () => {
    expect(maskBankInfo('123-456-789-1234')).toBe('***-***-***-1234');
  });
});

describe('maskEncryptedBankInfo — 암호화 → 마스킹', () => {
  it('정상 암호문 → 복호화 후 마스킹', () => {
    const enc = encrypt('110-123-456789');
    expect(maskEncryptedBankInfo(enc)).toBe('***-***-456789');
  });

  it('복호화 실패 → "****" (예외 삼킴)', () => {
    expect(maskEncryptedBankInfo('garbage')).toBe('****');
  });

  it('빈 입력 → "****"', () => {
    expect(maskEncryptedBankInfo('')).toBe('****');
  });
});
