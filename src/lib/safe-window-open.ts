const SAFE_NEW_WINDOW_FEATURES = 'noopener,noreferrer';

function withSafeWindowFeatures(features = ''): string {
  const parts = new Set(
    features
      .split(',')
      .map(part => part.trim())
      .filter(Boolean),
  );
  parts.add('noopener');
  parts.add('noreferrer');
  return Array.from(parts).join(',');
}

export function safeOpenNewWindow(url: string, features = ''): Window | null {
  if (typeof window === 'undefined') return null;

  const normalizedUrl = String(url ?? '');
  const opened = normalizedUrl === ''
    ? window.open('', '_blank')
    : window.open(normalizedUrl, '_blank', withSafeWindowFeatures(features || SAFE_NEW_WINDOW_FEATURES));

  if (opened) {
    try {
      opened.opener = null;
    } catch {
      // Some browser contexts make opener read-only; feature flags still cover URL popups.
    }
  }

  return opened;
}
