import Link from 'next/link';

export function ProductReviewNotice() {
  return (
    <main className="min-h-screen bg-stone-50 px-6 py-20 text-stone-900">
      <section className="mx-auto max-w-lg rounded-3xl border border-stone-200 bg-white px-7 py-10 shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-amber-700">상품 재검수 안내</p>
        <h1 className="mt-3 text-2xl font-bold leading-tight">상품 정보를 재검수하고 있습니다.</h1>
        <p className="mt-4 text-base leading-7 text-stone-600">
          정확한 내용은 상담을 통해 안내해 드립니다.
        </p>
        <Link
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-stone-900 px-6 text-sm font-semibold text-white"
          href="/concierge"
        >
          상담 안내 보기
        </Link>
      </section>
    </main>
  );
}
