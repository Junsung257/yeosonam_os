import { revalidatePath, revalidateTag } from 'next/cache';
import {
  BLOG_ANGLE_CACHE_TAG,
  BLOG_DESTINATION_CACHE_TAG,
  BLOG_DETAIL_CACHE_TAG,
  BLOG_LIST_CACHE_TAG,
} from '@/lib/blog-cache';
import { warmPublicBlogSurfacesBestEffort } from '@/lib/blog-public-surface-check';

function safeRevalidatePath(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // Revalidation is best effort and must not block publishing.
  }
}

function safeRevalidateTag(tag: string): void {
  try {
    revalidateTag(tag);
  } catch {
    // Revalidation is best effort and must not block publishing.
  }
}

export function revalidatePublicBlogCache(slug?: string | null, destination?: string | null): void {
  safeRevalidateTag(BLOG_LIST_CACHE_TAG);
  safeRevalidateTag(BLOG_DETAIL_CACHE_TAG);
  safeRevalidateTag(BLOG_DESTINATION_CACHE_TAG);
  safeRevalidateTag(BLOG_ANGLE_CACHE_TAG);
  safeRevalidatePath('/blog');
  safeRevalidatePath('/sitemap.xml');

  if (slug) safeRevalidatePath(`/blog/${slug}`);
  if (destination) safeRevalidatePath(`/blog/destination/${encodeURIComponent(destination)}`);

  warmPublicBlogSurfacesBestEffort({ slug, destination });
}
