import { NextRequest, type NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';
import { ApiErrors, successResponse } from '@/lib/api-response';
import {
  buildDestinationMediaStoragePath,
  type DestinationPhotoExtension,
  type DestinationPhotoProvider,
} from '@/lib/destination-media-storage';
import { destToEnKeyword, isPexelsConfigured, searchPexelsPhotos } from '@/lib/pexels';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  isSupportedCommonsLicense,
  searchWikimediaCommonsPhotos,
} from '@/lib/wikimedia-commons';

type SavePhotoBody = {
  destination?: string;
  provider?: DestinationPhotoProvider;
  pexels_id?: number | null;
  asset_id?: string;
  src_large?: string;
  photographer?: string;
  source_page_url?: string;
  source_file_title?: string | null;
  license?: string | null;
  license_url?: string | null;
  alt?: string;
};

const CONTENT_TYPE_EXTENSION: Record<string, DestinationPhotoExtension> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const dynamic = 'force-dynamic';

function privateNoStore<T extends NextResponse>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

function hasExpectedImageSignature(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  if (contentType === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

function parseHttpsUrl(
  value: string,
  allowedHosts: readonly string[],
): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && allowedHosts.includes(parsed.hostname)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function copyCandidateToStorage(input: {
  provider: DestinationPhotoProvider;
  destination: string;
  imageUrl: string;
}): Promise<string> {
  const allowedImageHost = input.provider === 'pexels'
    ? 'images.pexels.com'
    : 'upload.wikimedia.org';
  if (!parseHttpsUrl(input.imageUrl, [allowedImageHost])) {
    throw new Error(`Only direct ${allowedImageHost} assets may be copied.`);
  }

  const response = await fetch(input.imageUrl, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${input.provider} image fetch failed: ${response.status}`);
  }
  if (!parseHttpsUrl(response.url, [allowedImageHost])) {
    throw new Error('Image download redirected to an untrusted host.');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
  const extension = CONTENT_TYPE_EXTENSION[contentType];
  if (!extension) throw new Error(`Unsupported image content type: ${contentType || 'missing'}`);

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > 10 * 1024 * 1024) {
    throw new Error('Image must be between 1 byte and 10MB.');
  }
  const bytes = new Uint8Array(arrayBuffer);
  if (!hasExpectedImageSignature(bytes, contentType)) {
    throw new Error('Downloaded content does not match its image type.');
  }
  const storagePath = buildDestinationMediaStoragePath({
    destination: input.destination,
    provider: input.provider,
    extension,
  });
  const { error } = await supabaseAdmin.storage
    .from('destination-photos')
    .upload(storagePath, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('destination-photos')
    .getPublicUrl(storagePath);
  return publicUrl;
}

/** Search provider candidates only. Nothing is saved or approved. */
export async function GET(req: NextRequest) {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  try {
    const { searchParams } = req.nextUrl;
    const destination = searchParams.get('destination')?.trim();
    if (!destination) return privateNoStore(ApiErrors.badRequest('destination 파라미터 필요'));

    const provider = searchParams.get('provider') === 'pexels'
      ? 'pexels'
      : 'wikimedia_commons';
    const keyword = searchParams.get('keyword')?.trim() || destToEnKeyword(destination);

    if (provider === 'pexels') {
      if (!isPexelsConfigured()) {
        return privateNoStore(ApiErrors.unavailable('PEXELS_API_KEY 미설정'));
      }
      const photos = await searchPexelsPhotos(keyword, 8);
      return privateNoStore(successResponse({
        provider,
        keyword,
        photos: photos.map(photo => ({
          provider,
          id: photo.id,
          asset_id: String(photo.id),
          photographer: photo.photographer,
          src_large: photo.src.large2x,
          src_medium: photo.src.large,
          src_thumb: photo.src.medium,
          alt: photo.alt,
          source_page_url: photo.url,
          source_file_title: null,
          license: 'Pexels License',
          license_url: 'https://www.pexels.com/license/',
        })),
      }));
    }

    const photos = await searchWikimediaCommonsPhotos(keyword, 8);
    return privateNoStore(successResponse({
      provider,
      keyword,
      photos: photos.map(photo => ({
        ...photo,
        id: photo.asset_id,
      })),
    }));
  } catch (error) {
    console.error('[GET /api/destinations/hero-photo] error:', error);
    return privateNoStore(ApiErrors.internalError(
      error instanceof Error ? error.message : 'Destination photo search failed',
    ));
  }
}

/** Save one reviewed candidate as unapproved metadata. */
export async function POST(req: NextRequest) {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  try {
    if (!isSupabaseConfigured) {
      return privateNoStore(ApiErrors.unavailable('DB not configured'));
    }

    let body: SavePhotoBody;
    try {
      body = await req.json();
    } catch {
      return privateNoStore(ApiErrors.badRequest('유효하지 않은 JSON'));
    }

    const destination = body.destination?.trim();
    const provider = body.provider;
    const imageUrl = body.src_large?.trim();
    const photographer = body.photographer?.trim();
    const sourcePageUrl = body.source_page_url?.trim();
    if (provider !== 'pexels' && provider !== 'wikimedia_commons') {
      return privateNoStore(ApiErrors.badRequest('지원하지 않는 사진 공급자입니다.'));
    }
    if (!destination || !provider || !imageUrl || !photographer || !sourcePageUrl) {
      return privateNoStore(ApiErrors.badRequest(
        'destination, provider, src_large, photographer, source_page_url 필수',
      ));
    }

    if (provider === 'pexels') {
      if (
        !body.pexels_id
        || !parseHttpsUrl(sourcePageUrl, ['pexels.com', 'www.pexels.com'])
      ) {
        return privateNoStore(
          ApiErrors.badRequest('Pexels ID와 Pexels 상세 페이지가 필요합니다.'),
        );
      }
    } else {
      const sourceFileTitle = body.source_file_title?.trim();
      const license = body.license?.trim();
      const licenseUrl = body.license_url?.trim();
      if (
        !sourceFileTitle
        || !/^File:/i.test(sourceFileTitle)
        || !license
        || !isSupportedCommonsLicense(license)
        || !licenseUrl
        || !parseHttpsUrl(sourcePageUrl, ['commons.wikimedia.org'])
        || !parseHttpsUrl(licenseUrl, ['creativecommons.org', 'commons.wikimedia.org'])
      ) {
        return privateNoStore(ApiErrors.badRequest(
          'Wikimedia Commons 파일명, 허용 라이선스, 라이선스 URL, 원본 페이지가 필요합니다.',
        ));
      }
    }

    const publicUrl = await copyCandidateToStorage({
      provider,
      destination,
      imageUrl,
    });
    const { data, error } = await supabaseAdmin
      .from('destination_metadata')
      .upsert({
        destination,
        hero_image_url: publicUrl,
        hero_image_provider: provider,
        hero_image_pexels_id: provider === 'pexels' ? body.pexels_id : null,
        hero_photographer: photographer,
        hero_image_source_page_url: sourcePageUrl,
        hero_image_source_file_title: body.source_file_title?.trim() || null,
        hero_image_license: body.license?.trim() || null,
        hero_image_license_url: body.license_url?.trim() || null,
        hero_image_alt: body.alt?.trim() || null,
        photo_approved: false,
        photo_approved_at: null,
      }, { onConflict: 'destination' })
      .select()
      .maybeSingle();
    if (error) throw error;

    return privateNoStore(successResponse({
      data,
      public_url: publicUrl,
      message: '후보 저장 완료. 사장님 승인 전에는 고객에게 노출되지 않습니다.',
    }));
  } catch (error) {
    console.error('[POST /api/destinations/hero-photo] error:', error);
    return privateNoStore(
      ApiErrors.internalError(error instanceof Error ? error.message : '저장 실패'),
    );
  }
}
