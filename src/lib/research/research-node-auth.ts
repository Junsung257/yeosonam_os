import { timingSafeEqual } from 'node:crypto';

import { getSecret } from '@/lib/secret-registry';

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export function isResearchNodeAuthorized(request: Request): boolean {
  const expected = getSecret('RESEARCH_NODE_INGEST_TOKEN');
  if (!expected || expected.length < 32) return false;
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (!authorization.startsWith('Bearer ')) return false;
  const supplied = authorization.slice('Bearer '.length).trim();
  return supplied.length >= 32 && safeEqual(supplied, expected);
}
