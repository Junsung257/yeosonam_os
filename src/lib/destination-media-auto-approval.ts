import { isDestinationMediaApprovalReady, type DestinationMediaApprovalCandidate } from './destination-media-approval';

export type DestinationMediaAutoApprovalCandidate = DestinationMediaApprovalCandidate & {
  destination?: string | null;
  hero_image_alt?: string | null;
};

export type DestinationMediaAutoApprovalResult =
  | {
      approved: true;
      score: 1;
      evidence: Record<string, unknown>;
    }
  | {
      approved: false;
      score: number;
      reason: string;
    };

const SOURCE_IDENTITY_TERMS: Record<string, string[]> = {
  '가오슝': ['kaohsiung'],
  '괌': ['guam', 'tumon'],
  '나리타': ['narita', 'naritasan'],
  '방콕': ['bangkok', 'wat phra kaew', 'temple of the emerald'],
  '삿포로/니세코': ['sapporo', 'niseko', 'yotei', 'yōtei'],
  '석가장': ['shijiazhuang', 'zhaozhou bridge'],
  '시즈오카': ['shizuoka', 'satta pass', 'mount fuji'],
  '심양': ['shenyang'],
  '오사카': ['osaka'],
  '천진/진황도': ['tianjin', 'qinhuangdao', '秦皇岛'],
  '치앙마이': ['chiang mai'],
  '코타키나발루': ['kota kinabalu'],
  '클락': ['clark', 'angeles'],
};

function compact(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().toLocaleLowerCase('en-US').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
    : '';
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').trim() : '';
}

function exactDestinationAltMatch(destination: string, alt: string): boolean {
  const tokens = destination.split(/[\/·,]+/u).map(compact).filter(Boolean);
  const normalizedAlt = compact(alt);
  return tokens.some(token => normalizedAlt.includes(token));
}

function isApprovedLicenseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      url.hostname === 'creativecommons.org'
      || url.hostname === 'www.gnu.org'
      || url.hostname === 'commons.wikimedia.org'
    );
  } catch {
    return false;
  }
}

function isStoredDestinationImage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname.endsWith('.supabase.co')
      && url.pathname.includes('/storage/v1/object/public/destination-photos/destination-')
      && /\/hero-wikimedia_commons\.(?:jpe?g|png|webp)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function evaluateDestinationMediaAutoApproval(
  candidate: DestinationMediaAutoApprovalCandidate,
  options: { binaryVerified: boolean; checkedAt: string },
): DestinationMediaAutoApprovalResult {
  const destination = compact(candidate.destination);
  const originalDestination = typeof candidate.destination === 'string' ? candidate.destination.normalize('NFC').trim() : '';
  const alt = compact(candidate.hero_image_alt);
  const sourceTitle = compact(candidate.hero_image_source_file_title);
  const sourcePage = trimmed(candidate.hero_image_source_page_url);
  const imageUrl = trimmed(candidate.hero_image_url);
  const licenseUrl = trimmed(candidate.hero_image_license_url);

  if (!destination || !alt || !sourceTitle) {
    return { approved: false, score: 0, reason: 'destination identity evidence is incomplete' };
  }
  if (!isDestinationMediaApprovalReady(candidate)) {
    return { approved: false, score: 0, reason: 'provider attribution or license evidence is incomplete' };
  }
  if (candidate.hero_image_provider !== 'wikimedia_commons') {
    return { approved: false, score: 0, reason: 'automated approval currently accepts Wikimedia Commons only' };
  }
  if (!isStoredDestinationImage(imageUrl)) {
    return { approved: false, score: 0.2, reason: 'image is not a controlled destination-photo storage object' };
  }
  if (!sourcePage.toLowerCase().startsWith('https://commons.wikimedia.org/wiki/file:')) {
    return { approved: false, score: 0.3, reason: 'provider evidence is not a Wikimedia Commons file page' };
  }
  if (!isApprovedLicenseUrl(licenseUrl)) {
    return { approved: false, score: 0.4, reason: 'license terms URL is not on the approved license host list' };
  }
  if (!exactDestinationAltMatch(originalDestination, alt)) {
    return { approved: false, score: 0.5, reason: 'alt text does not explicitly identify the destination' };
  }

  const identityTerms = SOURCE_IDENTITY_TERMS[originalDestination] ?? [];
  const matchedIdentityTerm = identityTerms.find(term => sourceTitle.includes(compact(term)));
  if (!matchedIdentityTerm) {
    return { approved: false, score: 0.7, reason: 'source file title lacks a reviewed destination identity term' };
  }
  if (!options.binaryVerified) {
    return { approved: false, score: 0.8, reason: 'stored image binary could not be verified' };
  }

  return {
    approved: true,
    score: 1,
    evidence: {
      binary_verified: true,
      destination_identity_verified: true,
      provider_page_verified: true,
      attribution_complete: true,
      matched_identity_term: matchedIdentityTerm,
      checked_at: options.checkedAt,
      gate_version: 'destination-media-auto-approval-v1',
    },
  };
}

export async function verifyDestinationImageBinary(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-65535' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 206) return false;
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('image/')) return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 12) return false;
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    return jpeg || png || webp;
  } catch {
    return false;
  }
}
