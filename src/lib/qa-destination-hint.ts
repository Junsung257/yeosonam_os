const DEST = {
  danang: '\uB2E4\uB0AD',
  hoian: '\uD638\uC774\uC548',
  nhatrang: '\uB098\uD2B8\uB791',
  hanoi: '\uD558\uB178\uC774',
  phuquoc: '\uD478\uAFB8\uC625',
  hochiminh: '\uD638\uCE58\uBBFC',
  vietnam: '\uBCA0\uD2B8\uB0A8',
  bohol: '\uBCF4\uD640',
  cebu: '\uC138\uBD80',
  manila: '\uB9C8\uB2D0\uB77C',
  philippines: '\uD544\uB9AC\uD540',
  osaka: '\uC624\uC0AC\uCE74',
  kyoto: '\uAD50\uD1A0',
  fukuoka: '\uD6C4\uCFE0\uC624\uCE74',
  tokyo: '\uB3C4\uCFC4',
  sapporo: '\uC0BF\uD3EC\uB85C',
  japan: '\uC77C\uBCF8',
  guilin: '\uACC4\uB9BC',
  yangshuo: '\uC591\uC0AD',
  china: '\uC911\uAD6D',
  bangkok: '\uBC29\uCF55',
  pattaya: '\uD30C\uD0C0\uC57C',
  phuket: '\uD478\uCF13',
  chiangmai: '\uCE58\uC559\uB9C8\uC774',
  singapore: '\uC2F1\uAC00\uD3EC\uB974',
  taipei: '\uD0C0\uC774\uBCA0\uC774',
  macau: '\uB9C8\uCE74\uC624',
  bali: '\uBC1C\uB9AC',
  guam: '\uAD0C',
  boracay: '\uBCF4\uB77C\uCE74\uC774',
  saipan: '\uC0AC\uC774\uD310',
  paris: '\uD30C\uB9AC',
  london: '\uB7F0\uB358',
  rome: '\uB85C\uB9C8',
  barcelona: '\uBC14\uB974\uC140\uB85C\uB098',
  prague: '\uD504\uB77C\uD558',
  newyork: '\uB274\uC695',
  sydney: '\uC2DC\uB4DC\uB2C8',
  lisbon: '\uB9AC\uC2A4\uBCF8',
  xian: '\uC2DC\uC548',
  hongkong: '\uD64D\uCF69',
} as const;

export const QA_KNOWN_DESTINATION_KEYWORDS = [
  DEST.danang,
  DEST.hoian,
  DEST.nhatrang,
  DEST.hanoi,
  DEST.phuquoc,
  DEST.hochiminh,
  DEST.vietnam,
  DEST.bohol,
  DEST.cebu,
  DEST.manila,
  DEST.philippines,
  DEST.osaka,
  DEST.kyoto,
  DEST.fukuoka,
  DEST.tokyo,
  DEST.sapporo,
  DEST.japan,
  DEST.guilin,
  DEST.yangshuo,
  DEST.china,
  DEST.bangkok,
  DEST.pattaya,
  DEST.phuket,
  DEST.chiangmai,
  DEST.singapore,
  DEST.taipei,
  DEST.macau,
  DEST.bali,
  DEST.guam,
  DEST.boracay,
  DEST.saipan,
  DEST.paris,
  DEST.london,
  DEST.rome,
  DEST.barcelona,
  DEST.prague,
  DEST.newyork,
  DEST.sydney,
  DEST.lisbon,
  DEST.xian,
  DEST.hongkong,
] as const;

const QA_DESTINATION_ALIASES: Record<string, string> = {
  [DEST.vietnam]: DEST.danang,
  [DEST.philippines]: DEST.bohol,
  [DEST.japan]: DEST.osaka,
  [DEST.china]: DEST.guilin,
};

export function extractQaDestinationHint(text: string): string | null {
  if (!text?.trim()) return null;
  const normalized = text.normalize('NFC');
  for (const dest of QA_KNOWN_DESTINATION_KEYWORDS) {
    if (normalized.includes(dest)) return QA_DESTINATION_ALIASES[dest] ?? dest;
  }
  return null;
}

export function buildQaPackageHintSource(
  message: string,
  history: { role: string; content: string }[] = [],
  maxUserLines = 3,
): string {
  const lines: string[] = [message.trim()];
  for (let i = history.length - 1; i >= 0 && lines.length < maxUserLines; i--) {
    const m = history[i];
    if (m?.role === 'user' && typeof m.content === 'string') {
      const t = m.content.trim();
      if (t) lines.push(t);
    }
  }
  return lines.join('\n');
}
