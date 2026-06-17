export const BLOG_LIST_CACHE_TAG = 'blog-list';
export const BLOG_DETAIL_CACHE_TAG = 'blog-detail';
const BLOG_DATABASE_UNAVAILABLE = 'BLOG_DATABASE_UNAVAILABLE';

export function createBlogDatabaseUnavailableError(): Error {
  return new Error(BLOG_DATABASE_UNAVAILABLE);
}

export function isBlogDatabaseUnavailableError(err: unknown): boolean {
  return err instanceof Error && err.message === BLOG_DATABASE_UNAVAILABLE;
}
