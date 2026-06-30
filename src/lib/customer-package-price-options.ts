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

const PROVENANCE_LABEL_RE = /(?:source_|pdf_date_price_table|human_reader|document_raw|evidenceSpanId|evidenceHash|sourcePriceIrId)/i;

function isCustomerSafePriceLabel(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && !PROVENANCE_LABEL_RE.test(trimmed);
}

function fallbackPriceLabel(index: number): string {
  return `요금 옵션 ${index + 1}`;
}

export function getCustomerPriceOptionsForDate(
  rows: CustomerProductPriceRow[] | null | undefined,
  selectedDate: string | null | undefined,
): CustomerPackagePriceOption[] {
  if (!selectedDate || !Array.isArray(rows)) return [];

  const options = rows
    .filter((row) => row.target_date === selectedDate)
    .map((row): CustomerPackagePriceOption | null => {
      const price = Number(row.adult_selling_price);
      if (!Number.isFinite(price) || price <= 0) return null;
      const note = typeof row.note === 'string' ? row.note.trim() : '';
      return {
        targetDate: selectedDate,
        label: isCustomerSafePriceLabel(note) ? note : '',
        price,
      };
    })
    .filter((row): row is CustomerPackagePriceOption => row !== null)
    .sort((a, b) => a.price - b.price || a.label.localeCompare(b.label, 'ko-KR'));

  const labelCounts = new Map<string, number>();
  for (const option of options) {
    if (!option.label) continue;
    labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
  }

  return options.map((option, index) => {
    if (!option.label || (labelCounts.get(option.label) ?? 0) > 1) {
      return {
        ...option,
        label: fallbackPriceLabel(index),
      };
    }
    return option;
  });
}
