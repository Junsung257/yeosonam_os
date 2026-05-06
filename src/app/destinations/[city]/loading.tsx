export default function Loading() {
  return (
    <div className="min-h-screen bg-white animate-pulse">
      {/* Nav */}
      <div className="h-14 md:h-16 border-b border-admin-border bg-white" />

      {/* Hero */}
      <div className="relative h-[320px] md:h-[420px] bg-brand-light">
        <div className="absolute inset-0 bg-gradient-to-t from-[#1B3A6B]/40 to-transparent" />
        <div className="absolute bottom-6 left-0 right-0 px-6 max-w-5xl mx-auto space-y-2">
          <div className="h-3.5 w-28 rounded bg-white/30" />
          <div className="h-9 md:h-11 w-48 rounded-lg bg-white/40" />
          <div className="h-4 w-72 rounded bg-white/25" />
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8 space-y-10">
        {/* Climate card */}
        <div className="rounded-2xl border border-blue-200 bg-brand-light/40 p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="space-y-1.5 text-center">
              <div className="h-3 w-16 mx-auto rounded bg-blue-100" />
              <div className="h-6 w-12 mx-auto rounded bg-brand/20" />
              <div className="h-3 w-20 mx-auto rounded bg-brand-light" />
            </div>
          ))}
        </div>

        {/* Section: 대표 관광지 */}
        <div className="space-y-4">
          <div className="h-6 w-32 rounded-lg bg-blue-100" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="rounded-xl overflow-hidden border border-admin-border">
                <div className="aspect-[4/3] bg-brand-light" />
                <div className="p-2.5 space-y-1.5">
                  <div className="h-3.5 w-4/5 rounded bg-blue-100" />
                  <div className="h-3 w-3/5 rounded bg-bg-section" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section: 패키지 */}
        <div className="space-y-4">
          <div className="h-6 w-40 rounded-lg bg-blue-100" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-2xl overflow-hidden border border-admin-border">
                <div className="aspect-[4/3] bg-brand-light" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-full rounded bg-blue-100" />
                  <div className="h-4 w-3/4 rounded bg-blue-100" />
                  <div className="flex gap-2 pt-1">
                    <div className="h-5 w-16 rounded-full bg-brand-light" />
                    <div className="h-5 w-16 rounded-full bg-bg-section" />
                  </div>
                  <div className="h-6 w-24 rounded bg-brand/20" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section: 블로그 */}
        <div className="space-y-4">
          <div className="h-6 w-36 rounded-lg bg-blue-100" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0, 1].map(i => (
              <div key={i} className="flex gap-3 rounded-xl border border-admin-border p-3">
                <div className="w-20 h-20 shrink-0 rounded-lg bg-brand-light" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-full rounded bg-blue-100" />
                  <div className="h-3.5 w-4/5 rounded bg-blue-100" />
                  <div className="h-3 w-2/5 rounded bg-bg-section" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
