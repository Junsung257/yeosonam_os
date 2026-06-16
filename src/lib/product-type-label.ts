const PRODUCT_TYPE_LABELS: Record<string, string> = {
  golf: '골프',
  package: '패키지',
  cruise: '크루즈',
  ferry: '선박',
  airtel: '에어텔',
  honeymoon: '허니문',
  theme: '테마',
};

export function formatProductTypeLabel(value: string | null | undefined): string | null {
  const clean = String(value ?? '').trim();
  if (!clean) return null;
  return PRODUCT_TYPE_LABELS[clean.toLowerCase()] ?? clean;
}
