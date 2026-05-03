export default function Loading() {
  return (
    <div className="min-h-screen bg-white animate-pulse">
      <div className="h-14 md:h-16 border-b border-[#F2F4F6] bg-white" />

      {/* Hero */}
      <div className="relative h-[280px] md:h-[360px] bg-[#EBF3FE]">
        <div className="absolute inset-0 bg-gradient-to-t from-[#1B3A6B]/50 to-transparent" />
        <div className="absolute bottom-6 left-0 right-0 px-6 max-w-5xl mx-auto space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-3 w-8 rounded bg-white/30" />
            <div className="h-3 w-3 rounded bg-white/20" />
            <div className="h-3 w-20 rounded bg-white/40" />
          </div>
          <div className="h-8 md:h-10 w-40 rounded-lg bg-white/35" />
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10 space-y-10">
        {/* Category sections */}
        {[4, 3, 4].map((count, si) => (
          <div key={si} className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-5 w-20 rounded bg-[#DBEAFE]" />
              <div className="h-5 w-16 rounded bg-[#F2F4F6]" />
            </div>
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="rounded-xl overflow-hidden border border-[#F2F4F6]">
                  <div className="aspect-[4/3] bg-[#EBF3FE]" />
                  <div className="p-3 space-y-1.5">
                    <div className="h-3.5 w-4/5 rounded bg-[#DBEAFE]" />
                    <div className="h-3 w-3/5 rounded bg-[#F2F4F6]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Related packages */}
        <div className="space-y-3">
          <div className="h-5 w-36 rounded bg-[#DBEAFE]" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-xl border border-[#F2F4F6] p-5 space-y-2">
                <div className="h-4 w-full rounded bg-[#DBEAFE]" />
                <div className="h-4 w-3/4 rounded bg-[#DBEAFE]" />
                <div className="h-3 w-1/3 rounded bg-[#F2F4F6]" />
                <div className="h-6 w-20 rounded bg-[#EBF3FE]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
