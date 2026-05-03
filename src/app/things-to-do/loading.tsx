export default function Loading() {
  return (
    <div className="min-h-screen bg-white animate-pulse">
      <div className="h-14 md:h-16 border-b border-[#F2F4F6] bg-white" />

      {/* Hero */}
      <div className="bg-[#1B3A6B] py-14 md:py-20 px-4">
        <div className="mx-auto max-w-5xl space-y-3">
          <div className="h-9 md:h-12 w-48 rounded-lg bg-white/25" />
          <div className="h-4 w-72 rounded bg-white/15" />
        </div>
      </div>

      {/* Region chips */}
      <div className="border-b border-[#F2F4F6] px-4 py-4">
        <div className="mx-auto max-w-5xl flex gap-2 flex-wrap">
          {[52, 60, 44, 56, 48, 52, 64].map((w, i) => (
            <div key={i} className="h-8 rounded-full bg-[#F2F4F6]" style={{ width: w }} />
          ))}
        </div>
      </div>

      {/* Activities grid */}
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden border border-[#F2F4F6]">
              <div className="aspect-[4/3] bg-[#EBF3FE]" />
              <div className="p-3 space-y-1.5">
                <div className="h-3.5 w-4/5 rounded bg-[#DBEAFE]" />
                <div className="h-3 w-2/5 rounded bg-[#F2F4F6]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
