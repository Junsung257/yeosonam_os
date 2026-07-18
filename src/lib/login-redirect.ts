import { isUuid } from '@/lib/uuid';

export function getSafeLoginRedirect(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/admin';
  }

  return value;
}

export function tenantIdFromLoginRedirect(redirect: string): string | null {
  const match = /^\/tenant\/([^/?#]+)(?:[/?#]|$)/.exec(redirect);
  if (!match) return null;

  let tenantId: string;
  try {
    tenantId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  return isUuid(tenantId) ? tenantId : null;
}
