import BlogQueueClient from './BlogQueueClient';
import { resolveBlogQueueAdminView } from '@/lib/blog-queue-admin-view';

export const dynamic = 'force-dynamic';

interface BlogQueuePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BlogQueuePage({ searchParams }: BlogQueuePageProps) {
  const params = await searchParams;
  return (
    <BlogQueueClient
      initialView={resolveBlogQueueAdminView(params.scope, params.status)}
    />
  );
}
