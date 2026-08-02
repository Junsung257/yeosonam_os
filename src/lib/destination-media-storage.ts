import { createHash } from 'node:crypto';

export type DestinationPhotoProvider = 'pexels' | 'wikimedia_commons';
export type DestinationPhotoExtension = 'jpg' | 'png' | 'webp';

const PROVIDERS = new Set<DestinationPhotoProvider>([
  'pexels',
  'wikimedia_commons',
]);
const EXTENSIONS = new Set<DestinationPhotoExtension>([
  'jpg',
  'png',
  'webp',
]);

/**
 * Build a deterministic ASCII-only key for a customer-facing destination name.
 *
 * Display names may contain Korean, spaces, slashes, punctuation, or canonically
 * equivalent Unicode sequences. They must never be used directly as Storage
 * object path segments.
 */
export function destinationMediaKey(destination: string): string {
  const normalized = destination.trim().normalize('NFC');
  if (!normalized) throw new Error('Destination is required for media storage.');

  return createHash('sha256')
    .update(normalized, 'utf8')
    .digest('hex')
    .slice(0, 24);
}

export function buildDestinationMediaStoragePath(input: {
  destination: string;
  provider: DestinationPhotoProvider;
  extension: DestinationPhotoExtension;
}): string {
  if (!PROVIDERS.has(input.provider)) {
    throw new Error('Unsupported destination photo provider.');
  }
  if (!EXTENSIONS.has(input.extension)) {
    throw new Error('Unsupported destination photo extension.');
  }

  return `destination-${destinationMediaKey(input.destination)}/hero-${input.provider}.${input.extension}`;
}
