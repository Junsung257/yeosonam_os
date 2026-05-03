/**
 * 원격 이미지 URL 검사 — 빈 문자열·상대경로·비-http(s) 는 Next/Image 에 넘기지 않음
 */
export function isSafeImageSrc(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u) return false;
  if (u.startsWith('//')) return true;
  return /^https?:\/\//i.test(u);
}

type GalleryPhoto = { src_medium?: string | null; src_large?: string | null };

/** 관광지 photos 에서 카드/히어로용 URL 하나 (용량 우선: medium → large) */
export function pickAttractionPhotoUrl(photos: GalleryPhoto[] | null | undefined): string | null {
  if (!photos?.length) return null;
  for (const photo of photos) {
    for (const raw of [photo.src_medium, photo.src_large]) {
      if (!isSafeImageSrc(raw)) continue;
      return raw.trim();
    }
  }
  return null;
}

/** 목록에서 상품별로 겹치지 않게 고를 때 — medium → large 순, used 에 넣고 반환 */
export function pickUnusedAttractionPhotoUrl(
  photos: GalleryPhoto[] | null | undefined,
  used: Set<string>,
): string | null {
  if (!photos?.length) return null;
  for (const photo of photos) {
    for (const raw of [photo.src_medium, photo.src_large]) {
      if (!isSafeImageSrc(raw)) continue;
      const u = raw.trim();
      if (used.has(u)) continue;
      used.add(u);
      return u;
    }
  }
  return null;
}
