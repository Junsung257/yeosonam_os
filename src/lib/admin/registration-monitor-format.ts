export function formatScore100(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${Math.round(safeValue)} / 100`;
}

export function formatRatioPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return value > 1 ? formatScore100(value) : `${Math.round(value * 1000) / 10}%`;
}
