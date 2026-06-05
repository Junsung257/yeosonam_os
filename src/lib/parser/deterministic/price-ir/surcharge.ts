export function hasSurchargeSection(rawText: string): boolean {
  return /써\s*챠\s*지|써\s*차\s*지|surcharge/i.test(rawText);
}
