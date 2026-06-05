export function inferAccommodationsFromRawText(rawText: string | null | undefined): string[] {
  if (!rawText?.trim()) return [];

  const hotels: string[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:HOTEL|호텔)\s*:\s*(.+?)\s*$/i);
    if (!match?.[1]) continue;
    const cleaned = match[1]
      .replace(/\s+/g, ' ')
      .replace(/\s+-\s*$/, '')
      .trim();
    if (cleaned.length < 2 || cleaned.length > 120) continue;
    if (/조식|석식|중식|체크인|체크아웃|이동/.test(cleaned)) continue;
    hotels.push(cleaned);
  }

  return [...new Set(hotels)];
}
