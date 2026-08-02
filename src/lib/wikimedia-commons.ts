const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIMEDIA_USER_AGENT =
  'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) destination-media-review';

type WikimediaMetadataValue = {
  value?: unknown;
};

type WikimediaImageInfo = {
  url?: unknown;
  thumburl?: unknown;
  descriptionurl?: unknown;
  width?: unknown;
  height?: unknown;
  mime?: unknown;
  extmetadata?: Record<string, WikimediaMetadataValue | undefined>;
};

type WikimediaPage = {
  pageid?: unknown;
  title?: unknown;
  imageinfo?: WikimediaImageInfo[];
};

export type WikimediaCommonsPhoto = {
  provider: 'wikimedia_commons';
  asset_id: string;
  source_file_title: string;
  photographer: string;
  source_page_url: string;
  license: string;
  license_url: string;
  src_large: string;
  src_medium: string;
  src_thumb: string;
  width: number;
  height: number;
  alt: string;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stripHtml(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const stripped = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || null;
}

function safeUrl(value: unknown, allowedHost: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && parsed.hostname === allowedHost
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function isSupportedCommonsLicense(value: unknown): boolean {
  const license = stripHtml(value);
  if (!license) return false;
  return /^CC BY(?:-SA)?(?: \d(?:\.\d)?)?(?: [a-z]{2,3})?$/i.test(license)
    || /^CC0(?: \d(?:\.\d)?)?$/i.test(license)
    || /^Public domain$/i.test(license);
}

function canonicalLicenseUrl(value: unknown): string | null {
  const license = stripHtml(value);
  if (!license) return null;
  const ccByMatch = license.match(
    /^CC BY(-SA)?(?: (\d(?:\.\d)?))?(?: [a-z]{2,3})?$/i,
  );
  if (ccByMatch) {
    const family = ccByMatch[1] ? 'by-sa' : 'by';
    const version = ccByMatch[2] ?? '4.0';
    return `https://creativecommons.org/licenses/${family}/${version}/`;
  }
  if (/^CC0(?: \d(?:\.\d)?)?$/i.test(license)) {
    return 'https://creativecommons.org/publicdomain/zero/1.0/';
  }
  if (/^Public domain$/i.test(license)) {
    return 'https://creativecommons.org/publicdomain/mark/1.0/';
  }
  return null;
}

function metadata(
  image: WikimediaImageInfo,
  key: string,
): string | null {
  return stripHtml(image.extmetadata?.[key]?.value);
}

function photoFromPage(page: WikimediaPage): WikimediaCommonsPhoto | null {
  const image = page.imageinfo?.[0];
  if (!image) return null;

  const sourceFileTitle = text(page.title);
  const pageId = number(page.pageid);
  const width = number(image.width);
  const height = number(image.height);
  const mime = text(image.mime);
  const sourcePageUrl = safeUrl(image.descriptionurl, 'commons.wikimedia.org');
  const originalUrl = safeUrl(image.url, 'upload.wikimedia.org');
  const thumbnailUrl = safeUrl(image.thumburl, 'upload.wikimedia.org') ?? originalUrl;
  const photographer = metadata(image, 'Artist') ?? metadata(image, 'Credit');
  const license = metadata(image, 'LicenseShortName');
  const licenseUrl = safeUrl(metadata(image, 'LicenseUrl'), 'creativecommons.org')
    ?? safeUrl(metadata(image, 'LicenseUrl'), 'commons.wikimedia.org')
    ?? canonicalLicenseUrl(license);
  const alt = metadata(image, 'ObjectName')
    ?? metadata(image, 'ImageDescription')
    ?? sourceFileTitle?.replace(/^File:/i, '').replace(/\.[^.]+$/, '')
    ?? null;

  if (
    !sourceFileTitle
    || !pageId
    || !width
    || !height
    || width <= height
    || width < 1200
    || !mime
    || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)
    || !sourcePageUrl
    || !originalUrl
    || !thumbnailUrl
    || !photographer
    || !license
    || !licenseUrl
    || !isSupportedCommonsLicense(license)
    || !alt
  ) {
    return null;
  }

  return {
    provider: 'wikimedia_commons',
    asset_id: String(pageId),
    source_file_title: sourceFileTitle,
    photographer,
    source_page_url: sourcePageUrl,
    license,
    license_url: licenseUrl,
    // Store the reviewed 1200px derivative rather than an unbounded original.
    // Commons originals can exceed our 10MB bucket limit; the derivative is
    // still large enough for the mobile hero and keeps the copied asset stable.
    src_large: thumbnailUrl,
    src_medium: thumbnailUrl,
    src_thumb: thumbnailUrl,
    width,
    height,
    alt,
  };
}

export async function searchWikimediaCommonsPhotos(
  query: string,
  limit = 8,
): Promise<WikimediaCommonsPhoto[]> {
  const normalizedQuery = query.replace(/\s+/g, ' ').trim();
  if (!normalizedQuery) return [];

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `${normalizedQuery} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(Math.min(Math.max(limit * 2, 6), 20)),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime|size',
    iiurlwidth: '1200',
    maxlag: '5',
    origin: '*',
  });
  const response = await fetch(`${WIKIMEDIA_API}?${params}`, {
    headers: {
      'Api-User-Agent': WIKIMEDIA_USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Wikimedia Commons search is temporarily rate-limited. Please retry shortly.');
    }
    throw new Error(`Wikimedia Commons API failed: ${response.status}`);
  }

  const payload = await response.json() as { query?: { pages?: WikimediaPage[] } };
  return (payload.query?.pages ?? [])
    .map(photoFromPage)
    .filter((photo): photo is WikimediaCommonsPhoto => Boolean(photo))
    .slice(0, Math.max(1, limit));
}

/**
 * Existing attraction-photo contract. This is intentionally stricter than the
 * destination hero contract: attraction P18 automation rejects ShareAlike
 * media, while destination hero candidates remain human-reviewed and preserve
 * the full attribution/license record.
 */
export interface CommonsPhoto {
  filename: string;
  thumb_url: string;
  full_url: string;
  description_url: string;
  license: string | null;
  license_url: string | null;
  author: string | null;
  safe_to_use: boolean;
}

function isSafeForAutomatedAttractionUse(licenseShortName: string | null): boolean {
  if (!licenseShortName) return false;
  const normalized = licenseShortName.toLowerCase().replace(/[-_]+/g, ' ');
  if (normalized.includes('sa')) return false;
  return normalized.includes('cc0')
    || normalized.includes('public domain')
    || normalized.includes('cc by')
    || normalized === 'cc by';
}

export async function fetchCommonsPhotoMeta(
  filename: string,
  width = 800,
): Promise<CommonsPhoto | null> {
  if (!filename) return null;
  const title = filename.startsWith('File:') ? filename : `File:${filename}`;
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: String(width),
    format: 'json',
    formatversion: '2',
  });

  try {
    const response = await fetch(`${WIKIMEDIA_API}?${params}`, {
      headers: { 'Api-User-Agent': WIKIMEDIA_USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      query?: {
        pages?: Array<{
          imageinfo?: Array<{
            url?: unknown;
            thumburl?: unknown;
            descriptionurl?: unknown;
            extmetadata?: Record<string, WikimediaMetadataValue | undefined>;
          }>;
        }>;
      };
    };
    const info = payload.query?.pages?.[0]?.imageinfo?.[0];
    if (!info) return null;

    const fullUrl = safeUrl(info.url, 'upload.wikimedia.org');
    const thumbUrl = safeUrl(info.thumburl, 'upload.wikimedia.org') ?? fullUrl;
    const descriptionUrl = safeUrl(info.descriptionurl, 'commons.wikimedia.org')
      ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`;
    if (!fullUrl || !thumbUrl) return null;

    const license = stripHtml(info.extmetadata?.LicenseShortName?.value);
    const licenseUrl = safeUrl(
      info.extmetadata?.LicenseUrl?.value,
      'creativecommons.org',
    ) ?? safeUrl(info.extmetadata?.LicenseUrl?.value, 'commons.wikimedia.org')
      ?? canonicalLicenseUrl(license);
    const author = stripHtml(info.extmetadata?.Artist?.value);

    return {
      filename,
      thumb_url: thumbUrl,
      full_url: fullUrl,
      description_url: descriptionUrl,
      license,
      license_url: licenseUrl,
      author,
      safe_to_use: isSafeForAutomatedAttractionUse(license),
    };
  } catch {
    return null;
  }
}

export async function fetchImageFilenameByQid(qid: string): Promise<string | null> {
  if (!/^Q\d+$/.test(qid)) return null;
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: qid,
    props: 'claims',
    format: 'json',
  });
  try {
    const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {
      headers: { 'Api-User-Agent': WIKIMEDIA_USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      entities?: Record<string, {
        claims?: Record<string, Array<{
          mainsnak?: { datavalue?: { value?: unknown } };
        }>>;
      }>;
    };
    return text(payload.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value);
  } catch {
    return null;
  }
}

export async function geosearchCommons(
  lat: number,
  lon: number,
  radiusM = 500,
  limit = 10,
): Promise<Array<{ title: string }>> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const params = new URLSearchParams({
    action: 'query',
    list: 'geosearch',
    gscoord: `${lat}|${lon}`,
    gsradius: String(radiusM),
    gslimit: String(limit),
    gsnamespace: '6',
    format: 'json',
    formatversion: '2',
  });
  try {
    const response = await fetch(`${WIKIMEDIA_API}?${params}`, {
      headers: { 'Api-User-Agent': WIKIMEDIA_USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return [];
    const payload = await response.json() as {
      query?: { geosearch?: Array<{ title: string }> };
    };
    return payload.query?.geosearch ?? [];
  } catch {
    return [];
  }
}
