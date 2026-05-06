export default function Loading() {
  return (
    <div className="min-h-screen bg-white animate-pulse">
      {/* Nav */}
      <div className="h-14 md:h-16 border-b border-admin-border bg-white" />

      {/* Blue gradient header */}
      <header className="bg-gradient-to-r from-brand to-brand-dark py-14 md:py-20 px-4">
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-3.5 w-8 rounded bg-white/20" />
            <div className="h-3 w-3 rounded bg-white/20" />
            <div className="h-3.5 w-12 rounded bg-white/20" />
            <div className="h-3 w-3 rounded bg-white/20" />
            <div className="h-3.5 w-16 rounded bg-white/30" />
          </div>
          <div className="h-8 w-8 rounded bg-white/20" />
          <div className="h-10 md:h-14 w-52 rounded-lg bg-white/25" />
          <div className="h-4 w-64 rounded bg-white/15" />
        </div>
      </header>

      {/* Content grid */}
      <div className="mx-auto max-w-6xl px-4 md:px-6 py-12 space-y-12">
        {/* Packages CTA */}
        <div className="space-y-3">
          <div className="h-5 w-36 rounded bg-blue-100" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-xl border border-admin-border p-5 space-y-2">
                <div className="h-4 w-full rounded bg-blue-100" />
                <div className="h-4 w-3/4 rounded bg-blue-100" />
                <div className="h-3 w-1/3 rounded bg-bg-section" />
                <div className="h-6 w-20 rounded bg-brand-light" />
              </div>
            ))}
          </div>
        </div>

        {/* Blog posts grid */}
        <div className="space-y-3">
          <div className="h-5 w-28 rounded bg-blue-100" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl overflow-hidden border border-admin-border">
                <div className="aspect-[4/3] bg-brand-light" />
                <div className="p-4 space-y-2">
                  <div className="flex gap-2">
                    <div className="h-5 w-14 rounded-full bg-brand-light" />
                  </div>
                  <div className="h-4 w-full rounded bg-blue-100" />
                  <div className="h-4 w-4/5 rounded bg-blue-100" />
                  <div className="h-3.5 w-1/3 rounded bg-bg-section" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
