import { createHash } from 'crypto';

/**
 * 동일 카탈로그가 띄어쓰기·개행만 달라도 같은 걸로 보게 정규화 후 SHA-256.
 * document_hashes.normalized_hash / 업로드 중복 판별용 (원문 의미 변경 없이 비교만).
 */
export function normalizeTextForDedup(raw: string): string {
  return raw
    .replace(/\uFEFF/g, '')
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .toLowerCase();
}

export function computeNormalizedContentHash(raw: string): string {
  return createHash('sha256').update(normalizeTextForDedup(raw), 'utf8').digest('hex');
}
