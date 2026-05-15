/**
 * @file wikimedia-commons.ts — Wikimedia Commons 이미지 API.
 *
 * STRICT SSOT (PR #89 Phase 2b):
 *   Pexels 가 한국어 검색 시 false-positive 빈번 (서안 → 한국 서안군 사진).
 *   Wikidata P18 (대표 이미지) → Commons 직접 접근으로 false-match 0.
 *   라이선스: 항목별 CC0/CC-BY/CC-BY-SA 혼재 → 메타로 license 추적, CC-BY-SA 는 reject.
 *
 * 사용 흐름: Wikidata QID → P18 image_filename → Commons FilePath URL + license 메타.
 */
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) attraction-photo-fetch';

export interface CommonsPhoto {
  filename: string;
  thumb_url: string;
  full_url: string;
  description_url: string;
  /** 라이선스 short name (예: 'CC0', 'CC-BY-3.0'). 못 받으면 null → 사용 금지 */
  license: string | null;
  /** 라이선스 URL (Creative Commons 본문 링크) */
  license_url: string | null;
  /** 저자 (HTML 또는 plain text) */
  author: string | null;
  /** 우리가 안전하게 사용 가능한가 (CC0/PD/CC-BY 만 true) */
  safe_to_use: boolean;
}

function classifyLicense(licenseShortName: string | null): boolean {
  if (!licenseShortName) return false;
  const s = licenseShortName.toLowerCase();
  // CC-BY-SA 는 share-alike 의무로 우리 콘텐츠 라이선스 영향 가능성 → reject
  if (s.includes('sa')) return false;
  // CC0, PD, CC-BY 안전
  if (s.includes('cc0') || s.includes('public domain') || s.includes('cc-by') || s === 'cc by') return true;
  // GFDL 등은 보수적 reject
  return false;
}

/**
 * Commons 파일명 → thumb URL + license/author 메타.
 *
 * @param filename Wikidata P18 의 파일명 (예: "Terracotta Army, View of Pit 1.jpg")
 * @param width thumb 너비 (default 800)
 */
export async function fetchCommonsPhotoMeta(
  filename: string,
  width = 800,
): Promise<CommonsPhoto | null> {
  if (!filename) return null;
  const title = filename.startsWith('File:') ? filename : `File:${filename}`;
  const url =
    `${COMMONS_API}?action=query` +
    `&titles=${encodeURIComponent(title)}` +
    `&prop=imageinfo` +
    `&iiprop=url%7Cextmetadata%7Cmime` +
    `&iiurlwidth=${width}` +
    `&format=json` +
    `&formatversion=2`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const json = await res.json() as {
      query?: {
        pages?: Array<{
          imageinfo?: Array<{
            url: string;
            thumburl?: string;
            descriptionurl?: string;
            extmetadata?: Record<string, { value: string }>;
          }>;
        }>;
      };
    };
    const info = json.query?.pages?.[0]?.imageinfo?.[0];
    if (!info) return null;

    const meta = info.extmetadata ?? {};
    const license = meta.LicenseShortName?.value ?? null;
    const licenseUrl = meta.LicenseUrl?.value ?? null;
    const author = stripHtml(meta.Artist?.value ?? null);
    const safe = classifyLicense(license);

    return {
      filename,
      thumb_url: info.thumburl ?? info.url,
      full_url: info.url,
      description_url: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      license,
      license_url: licenseUrl,
      author,
      safe_to_use: safe,
    };
  } catch {
    return null;
  }
}

function stripHtml(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Wikidata QID → P18 image filename 직접 조회.
 *   wikidata-suggest.ts 와 별개로 단독 동작하도록 self-contained 호출.
 *   PR #89 Phase 2b 가 PR #87 (Wikidata 모듈) 머지 대기 없이 박힐 수 있게.
 */
export async function fetchImageFilenameByQid(qid: string): Promise<string | null> {
  if (!qid || !/^Q\d+$/.test(qid)) return null;
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities` +
    `&ids=${qid}` +
    `&props=claims` +
    `&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const json = await res.json() as {
      entities?: Record<string, {
        claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value: string } } }>>;
      }>;
    };
    return json.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * 좌표 기반 Commons geosearch — Wikidata P625(coordinate)가 있을 때 반경 검색.
 *
 * @param lat latitude
 * @param lon longitude
 * @param radius_m 반경 (m), default 500m
 * @param limit 최대 결과
 */
export async function geosearchCommons(
  lat: number,
  lon: number,
  radius_m = 500,
  limit = 10,
): Promise<Array<{ title: string }>> {
  const url =
    `${COMMONS_API}?action=query` +
    `&list=geosearch` +
    `&gscoord=${lat}%7C${lon}` +
    `&gsradius=${radius_m}` +
    `&gslimit=${limit}` +
    `&gsnamespace=6` +  // File: namespace
    `&format=json` +
    `&formatversion=2`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return [];
    const json = await res.json() as { query?: { geosearch?: Array<{ title: string }> } };
    return json.query?.geosearch ?? [];
  } catch {
    return [];
  }
}
