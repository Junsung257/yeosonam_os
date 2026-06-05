export type CustomerProductPriceRow = {
  target_date: string | null;
  adult_selling_price: number | null;
  note: string | null;
};

export type CustomerPackagePriceOption = {
  targetDate: string;
  label: string;
  price: number;
};

export function getCustomerPriceOptionsForDate(
  rows: CustomerProductPriceRow[] | null | undefined,
  selectedDate: string | null | undefined,
): CustomerPackagePriceOption[] {
  if (!selectedDate || !Array.isArray(rows)) return [];

  return rows
    .filter((row) => row.target_date === selectedDate)
    .map((row): CustomerPackagePriceOption | null => {
      const price = Number(row.adult_selling_price);
      if (!Number.isFinite(price) || price <= 0) return null;
      return {
        targetDate: selectedDate,
        label: typeof row.note === 'string' && row.note.trim() ? row.note.trim() : '요금 옵션',
        price,
      };
    })
    .filter((row): row is CustomerPackagePriceOption => row !== null)
    .sort((a, b) => a.price - b.price || a.label.localeCompare(b.label, 'ko-KR'));
}
