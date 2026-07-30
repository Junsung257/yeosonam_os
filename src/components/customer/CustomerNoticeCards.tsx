import type { CustomerNoticeCard } from '@/lib/customer-notice-cards';

export default function CustomerNoticeCards({
  notices,
  className = '',
}: {
  notices: CustomerNoticeCard[];
  className?: string;
}) {
  if (notices.length === 0) return null;

  return (
    <section
      className={`rounded-2xl border border-amber-200 bg-amber-50 p-4 ${className}`.trim()}
      aria-labelledby="customer-prebooking-notices"
    >
      <h2 id="customer-prebooking-notices" className="text-base font-extrabold text-amber-950">
        예약 전 필수 확인
      </h2>
      <div className="mt-3 space-y-3">
        {notices.map((notice, index) => (
          <article
            key={`${notice.title}-${index}`}
            className="rounded-xl border border-amber-100 bg-white/80 px-3.5 py-3"
          >
            <h3 className="text-sm font-bold text-slate-950">{notice.title}</h3>
            <p className="mt-1.5 whitespace-pre-line break-keep text-sm leading-6 text-slate-700">
              {notice.text}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
