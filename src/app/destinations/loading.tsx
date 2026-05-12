export default function Loading() {
  return (
    <div className="min-h-screen bg-white animate-pulse">
      {/* Nav */}
      <div className="h-14 md:h-16 border-b border-admin-border bg-white" />

      {/* Hero */}
      <header className="relative overflow-hidden bg-[#1B3A6B] py-16 md:py-24 px-4">
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="h-3.5 w-20 rounded bg-white/20" />
          <div className="h-10 md:h-14 w-56 rounded-lg bg-white/25" />
          <div className="h-4 w-80 rounded bg-white/15" />
          <div className="flex gap-4 pt-2">
            <div className="h-4 w-24 rounded bg-white/15" />
            <div className="h-4 w-28 rounded bg-white/15" />
          </div>
        </div>
      </header>

      {/* Destination grid */}
      <section className="mx-auto max-w-6xl px-4 md:px-6 py-12">
        <div className="h-6 w-24 rounded-lg bg-blue-100 mb-6" />
        <div className="grid gap-4 md:gap-6 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="relative h-72 md:h-80 rounded-xl overflow-hidden bg-brand-light">
              <div className="absolute bottom-0 left-0 right-0 p-4 space-y-1.5">
                <div className="h-5 w-24 rounded bg-white/40" />
                <div className="h-3.5 w-16 rounded bg-white/30" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
