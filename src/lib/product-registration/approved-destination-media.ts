import type { SupabaseClient } from '@supabase/supabase-js';

import { isSafeImageSrc } from '@/lib/image-url';

export type ApprovedDestinationMedia = {
  destination: string;
  url: string;
  photographer: string;
  provider: 'pexels' | 'wikimedia_commons' | 'owner_upload' | 'supplier_official';
  pexels_id: number | null;
  source_page_url: string | null;
  source_file_title: string | null;
  license: string | null;
  license_url: string | null;
  alt: string | null;
  approved_at: string;
  approval_source: 'owner_approved_destination_metadata' | 'automated_evidence_gate';
};

export type ApprovedDestinationMediaLookup =
  | { status: 'ready'; media: ApprovedDestinationMedia }
  | { status: 'not_found'; media: null }
  | { status: 'invalid'; media: null; reason: string }
  | { status: 'lookup_error'; media: null; reason: string };

type DestinationMetadataRow = {
  destination?: unknown;
  hero_image_url?: unknown;
  hero_image_pexels_id?: unknown;
  hero_photographer?: unknown;
  hero_image_source_page_url?: unknown;
  hero_image_source_file_title?: unknown;
  hero_image_provider?: unknown;
  hero_image_license?: unknown;
  hero_image_license_url?: unknown;
  hero_image_alt?: unknown;
  photo_approved_at?: unknown;
  photo_approval_source?: unknown;
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function mediaProvider(value: unknown): ApprovedDestinationMedia['provider'] | null {
  return value === 'pexels'
    || value === 'wikimedia_commons'
    || value === 'owner_upload'
    || value === 'supplier_official'
    ? value
    : null;
}

export async function loadApprovedDestinationMedia(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  destination: string | null | undefined;
}): Promise<ApprovedDestinationMediaLookup> {
  const destination = nonEmptyString(input.destination);
  if (!input.isSupabaseConfigured || !destination) {
    return { status: 'not_found', media: null };
  }

  const { data, error } = await input.supabase
    .from('destination_metadata')
    .select(
      'destination, hero_image_url, hero_image_pexels_id, hero_photographer, hero_image_provider, hero_image_source_page_url, hero_image_source_file_title, hero_image_license, hero_image_license_url, hero_image_alt, photo_approved_at, photo_approval_source',
    )
    .eq('destination', destination)
    .eq('photo_approved', true)
    .maybeSingle();

  if (error) {
    return {
      status: 'lookup_error',
      media: null,
      reason: `destination_metadata lookup failed: ${error.message}`,
    };
  }
  if (!data) return { status: 'not_found', media: null };

  const row = data as DestinationMetadataRow;
  const rowDestination = nonEmptyString(row.destination);
  const url = nonEmptyString(row.hero_image_url);
  const photographer = nonEmptyString(row.hero_photographer);
  const provider = mediaProvider(row.hero_image_provider);
  const sourcePageUrl = nonEmptyString(row.hero_image_source_page_url);
  const sourceFileTitle = nonEmptyString(row.hero_image_source_file_title);
  const license = nonEmptyString(row.hero_image_license);
  const licenseUrl = nonEmptyString(row.hero_image_license_url);
  const approvedAt = nonEmptyString(row.photo_approved_at);
  const approvalSource = row.photo_approval_source === 'owner_reviewed'
    ? 'owner_approved_destination_metadata'
    : row.photo_approval_source === 'automated_evidence_gate'
      ? 'automated_evidence_gate'
      : null;
  if (rowDestination !== destination) {
    return {
      status: 'invalid',
      media: null,
      reason: 'approved destination media key does not exactly match the package destination',
    };
  }
  if (!url || !isSafeImageSrc(url)) {
    return {
      status: 'invalid',
      media: null,
      reason: 'approved destination media URL is missing or unsafe',
    };
  }
  if (!photographer || !provider || !sourcePageUrl || !approvedAt || !approvalSource) {
    return {
      status: 'invalid',
      media: null,
      reason: 'approved destination media is missing provider, attribution, source page, or approval timestamp',
    };
  }
  if (provider === 'wikimedia_commons' && (!sourceFileTitle || !license || !licenseUrl)) {
    return {
      status: 'invalid',
      media: null,
      reason: 'approved Wikimedia media is missing file title or license evidence',
    };
  }

  return {
    status: 'ready',
    media: {
      destination,
      url,
      photographer,
      provider,
      pexels_id: finiteInteger(row.hero_image_pexels_id),
      source_page_url: sourcePageUrl,
      source_file_title: sourceFileTitle,
      license,
      license_url: licenseUrl,
      alt: nonEmptyString(row.hero_image_alt),
      approved_at: approvedAt,
      approval_source: approvalSource,
    },
  };
}
