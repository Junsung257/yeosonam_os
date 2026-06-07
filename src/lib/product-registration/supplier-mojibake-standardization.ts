export type KnownMojibakeProfile =
  | 'joshi-golf'
  | 'narita-nomori-golf'
  | 'xian-basic-3n'
  | 'xian-basic-4n'
  | 'xian-premium-3n'
  | 'xian-premium-4n';

export function detectKnownMojibakeSupplierProfile(text: string | null | undefined): KnownMojibakeProfile | null {
  if (!text) return null;
  if (/BX\?섎━\?\u0080\s+移섎컮\s+二좎떆\s+怨⑦봽/.test(text)) return 'joshi-golf';
  if (/BX\s+\?섎━\?\u0080\s+\?섎━\?\u0080\?몃え由/.test(text)) return 'narita-nomori-golf';
  if (/\?쒖븞\/吏꾩떆\?⑸쫱\+蹂묐쭏/.test(text)) {
    return /4諛/.test(text) ? 'xian-basic-4n' : 'xian-basic-3n';
  }
  if (/\?쒖븞\/\?붿궛\s+\?덇꺽\s+\?⑦궎吏/.test(text)) {
    return /4諛/.test(text) ? 'xian-premium-4n' : 'xian-premium-3n';
  }
  return null;
}

export function standardizeKnownMojibakeTitle(title: string): string {
  const profile = detectKnownMojibakeSupplierProfile(title);
  switch (profile) {
    case 'joshi-golf':
      return 'BX나리타 치바 죠시 골프 54H 3박4일';
    case 'narita-nomori-golf':
      return 'BX 나리타 나리타노모리 2색 골프 54H 3박4일';
    case 'xian-basic-3n':
      return 'BX 서안/진시황릉+병마용 3박5일';
    case 'xian-basic-4n':
      return 'BX 서안/진시황릉+병마용 4박6일';
    case 'xian-premium-3n':
      return '[노팁/노옵션/노쇼핑] BX 서안/화산 품격 패키지 3박5일';
    case 'xian-premium-4n':
      return '[노팁/노옵션/노쇼핑] BX 서안/화산 품격 패키지 4박6일';
    default:
      return title;
  }
}

export function standardizeKnownMojibakeSupplierText(text: string): string {
  const profile = detectKnownMojibakeSupplierProfile(text);
  if (!profile) return text;
  const title = standardizeKnownMojibakeTitle(text);
  return `${text.replace(/\r\n/g, '\n')}\n\n[표준화 제목]\n${title}\n`;
}
