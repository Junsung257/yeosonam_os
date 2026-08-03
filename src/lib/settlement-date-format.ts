const KST_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function formatSettlementTimestamp(
  value: string | null | undefined,
  options: { includeSeconds?: boolean; includeYear?: boolean } = {},
): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = Object.fromEntries(
    KST_TIMESTAMP_FORMATTER.formatToParts(date).map(part => [part.type, part.value]),
  );
  const dateLabel = options.includeYear
    ? `${parts.year}-${parts.month}-${parts.day}`
    : `${parts.month}-${parts.day}`;
  const base = `${dateLabel} ${parts.hour}:${parts.minute}`;
  return options.includeSeconds ? `${base}:${parts.second}` : base;
}

export function formatSettlementDate(value: string | null | undefined): string {
  return formatSettlementTimestamp(value, { includeYear: true }).slice(0, 10);
}
