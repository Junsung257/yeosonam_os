export type SourceFieldRepairPackage = {
  title?: string | null;
  raw_text?: string | null;
  airline?: string | null;
};

export type SourceBackedFieldRepair = {
  status: 'not_needed' | 'repaired' | 'unavailable';
  reason: string;
  airline?: string;
};

const AIRLINE_CODES = [
  '7C', 'BX', 'LJ', 'ZE', 'TW', 'KE', 'OZ', 'RS', 'VJ', 'VN',
  'CI', 'BR', 'MU', 'CZ', 'CA', 'TG', 'JL', 'NH',
];

function detectAirlineCode(text: string): string | null {
  for (const code of AIRLINE_CODES) {
    const re = new RegExp(`(?:^|[^A-Z0-9])${code}(?=[^A-Z0-9]|\\d{3,4}|$)`, 'i');
    if (re.test(text)) return code;
  }
  return null;
}

export function buildSourceBackedFieldRepair(pkg: SourceFieldRepairPackage): SourceBackedFieldRepair {
  const title = typeof pkg.title === 'string' ? pkg.title : '';
  const rawText = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
  const currentAirline = typeof pkg.airline === 'string' ? pkg.airline.trim().toUpperCase() : '';
  const detectedAirline = detectAirlineCode(title) ?? detectAirlineCode(rawText);
  if (!detectedAirline) return { status: 'unavailable', reason: 'source airline code not recognized' };
  if (currentAirline === detectedAirline) return { status: 'not_needed', reason: 'airline is source-backed' };
  return {
    status: 'repaired',
    reason: `replaced airline ${currentAirline || '(missing)'} with source-backed ${detectedAirline}`,
    airline: detectedAirline,
  };
}
