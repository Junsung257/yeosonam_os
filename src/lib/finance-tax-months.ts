const YEAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isFinanceYearMonth(value: string | null | undefined): value is string {
  return YEAR_MONTH_PATTERN.test(String(value ?? ''));
}

export function buildFinanceTaxMonthOptions(initialMonth: string, count = 12): string[] {
  if (!isFinanceYearMonth(initialMonth)) return [];
  const [year, month] = initialMonth.split('-').map(Number);
  const initialIndex = year * 12 + month - 1;

  return Array.from({ length: Math.max(0, count) }, (_, offset) => {
    const index = initialIndex - offset;
    const optionYear = Math.floor(index / 12);
    const optionMonth = index % 12 + 1;
    return `${optionYear}-${String(optionMonth).padStart(2, '0')}`;
  });
}
