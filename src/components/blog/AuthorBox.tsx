import Link from 'next/link';
import { fmtDateISO } from '@/lib/admin-utils';

interface Props {
  publishedAt: string;
  contentModifiedAt?: string | null;
  factCheckedAt?: string | null;
  author?: { slug: string; displayName: string; bio?: string | null } | null;
  reviewer?: { displayName: string; reviewedAt: string; scope: string } | null;
}

export default function AuthorBox({
  publishedAt,
  contentModifiedAt,
  factCheckedAt,
  author,
  reviewer,
}: Props) {
  return (
    <section className="not-prose my-12 rounded-2xl border border-slate-200 bg-slate-50 p-5 md:p-6" aria-label="작성 및 검수 정보" data-blog-supporting="author">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand font-bold text-white" aria-hidden="true">
          {(author?.displayName || '여소남').slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-slate-950">{author?.displayName || '여소남 편집부'}</p>
          {author?.bio && <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{author.bio}</p>}
          {author?.slug && (
            <Link href={`/blog/author/${encodeURIComponent(author.slug)}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand hover:underline">
              작성자 프로필
            </Link>
          )}
          <dl className="mt-3 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
            <div><dt className="inline font-semibold">발행</dt> <dd className="inline">{fmtDateISO(publishedAt)}</dd></div>
            {contentModifiedAt && <div><dt className="inline font-semibold">내용 수정</dt> <dd className="inline">{fmtDateISO(contentModifiedAt)}</dd></div>}
            {factCheckedAt && <div><dt className="inline font-semibold">사실 확인</dt> <dd className="inline">{fmtDateISO(factCheckedAt)}</dd></div>}
          </dl>
          {reviewer && (
            <div className="mt-4 border-t border-slate-200 pt-3 text-sm text-slate-600">
              <p><strong className="text-slate-800">검수:</strong> {reviewer.displayName} · {fmtDateISO(reviewer.reviewedAt)}</p>
              <p className="mt-1"><strong className="text-slate-800">검토 범위:</strong> {reviewer.scope}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
