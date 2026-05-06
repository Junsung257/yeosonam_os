/**
 * AES-256-GCM 암호화/복호화 유틸리티
 * 계좌번호 등 민감 정보 저장용
 *
 * 환경 변수: ENCRYPTION_SECRET_KEY (64자리 hex = 32바이트)
 * 생성 명령: openssl rand -hex 32
 *
 * 저장 형식: "iv_hex:authTag_hex:ciphertext_hex"
 */
import crypto from 'crypto';
import { getSecret } from '@/lib/secret-registry';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // GCM 권장 12바이트
const TAG_LENGTH = 16;  // 128비트 인증 태그

function getKey(): Buffer {
  const hex = getSecret('ENCRYPTION_SECRET_KEY');
  if (!hex || hex.length !== 64) {
    // 키 없으면 경고 후 랜덤 임시키 (개발 환경 대응)
    if (process.env.NODE_ENV === 'development') {
      return crypto.randomBytes(32);
    }
    throw new Error('ENCRYPTION_SECRET_KEY 환경변수가 설정되지 않았습니다. (64자리 hex)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * 평문을 암호화하여 "iv:authTag:ciphertext" 형식의 문자열로 반환
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

/**
 * "iv:authTag:ciphertext" 형식의 문자열을 복호화하여 평문 반환
 */
export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('암호화 형식이 올바르지 않습니다.');

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * 계좌번호를 마스킹하여 표시
 * "110-123-456789" → "***-***-456789" (뒤 6자리만 노출)
 * 복호화된 평문을 받아서 마스킹 처리
 */
export function maskBankInfo(decrypted: string): string {
  if (!decrypted) return '****';
  // 숫자와 하이픈만 남기고 마스킹
  const cleaned = decrypted.replace(/[^0-9\-]/g, '');
  const parts = cleaned.split('-');
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    return parts
      .slice(0, parts.length - 1)
      .map(p => '*'.repeat(p.length))
      .concat(last)
      .join('-');
  }
  // 하이픈 없는 경우: 뒤 4자리만
  if (cleaned.length > 4) {
    return '*'.repeat(cleaned.length - 4) + cleaned.slice(-4);
  }
  return cleaned;
}

/**
 * 암호화된 계좌 정보 마스킹 (복호화 후 마스킹)
 * 복호화 실패 시 "****" 반환
 */
export function maskEncryptedBankInfo(encrypted: string): string {
  try {
    const plain = decrypt(encrypted);
    return maskBankInfo(plain);
  } catch {
    return '****';
  }
}
