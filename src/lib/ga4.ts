const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{6,20}$/;
const GA4_PRODUCTION_HOSTS = new Set(['yeosonam.com', 'www.yeosonam.com']);

export function normalizeGa4MeasurementId(value: string | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return GA4_MEASUREMENT_ID_PATTERN.test(normalized) ? normalized : null;
}

export function isGa4ProductionHost(hostname: string): boolean {
  return GA4_PRODUCTION_HOSTS.has(hostname.trim().toLowerCase());
}

export function isGa4PublicPath(pathname: string): boolean {
  return !pathname.startsWith('/admin') && !pathname.startsWith('/m/admin');
}
