export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 animate-pulse">
      {/* Nav */}
      <div className="h-14 md:h-16 border-b border-admin-border bg-white" />

      {/* Affiliate intro section */}
      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
          <div className="flex items-center gap-4 mb-5">
            <div className="h-16 w-16 rounded-full bg-brand-light shrink-0" />
            <div className="space-y-2">
              <div className="h-5 w-32 rounded bg-blue-100" />
              <div className="h-3.5 w-20 rounded bg-bg-section" />
            </div>
          </div>
          <div className="space-y-2 max-w-xl">
            <div className="h-3.5 w-full rounded bg-bg-section" />
            <div className="h-3.5 w-5/6 rounded bg-bg-section" />
            <div className="h-3.5 w-4/5 rounded bg-bg-section" />
          </div>
        </div>
      </section>

      {/* Package cards */}
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="h-6 w-32 rounded-lg bg-blue-100 mb-5" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white border border-admin-border overflow-hidden">
              <div className="h-40 bg-brand-light" />
              <div className="p-4 space-y-2">
                <div className="h-4 w-full rounded bg-blue-100" />
                <div className="h-4 w-3/4 rounded bg-blue-100" />
                <div className="h-3 w-2/5 rounded bg-bg-section" />
                <div className="flex items-center justify-between pt-1">
                  <div className="h-6 w-20 rounded bg-brand-light" />
                  <div className="h-8 w-20 rounded-lg bg-brand/20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
