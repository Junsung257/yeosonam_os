export default function Loading() {
  return (
    <div className="min-h-screen bg-white animate-pulse">
      {/* Nav */}
      <div className="h-14 md:h-16 border-b border-[#F2F4F6] bg-white" />

      {/* Hero header */}
      <div className="bg-gradient-to-br from-[#1B3A6B] to-[#3182F6] py-12 px-4">
        <div className="mx-auto max-w-5xl space-y-3">
          <div className="h-8 md:h-10 w-48 rounded-lg bg-white/20" />
          <div className="h-4 w-72 rounded bg-white/10" />
          {/* Filter chips */}
          <div className="flex gap-2 pt-2 flex-wrap">
            {[44, 52, 48, 56, 60, 44].map((w, i) => (
              <div key={i} className="h-8 rounded-full bg-white/15" style={{ width: w }} />
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        {/* Featured 3-up */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Large featured */}
          <div className="md:col-span-2 rounded-2xl overflow-hidden border border-[#F2F4F6]">
            <div className="aspect-[16/9] bg-[#EBF3FE]" />
            <div className="p-4 space-y-2">
              <div className="h-4 w-16 rounded-full bg-[#EBF3FE]" />
              <div className="h-5 w-4/5 rounded bg-[#DBEAFE]" />
              <div className="h-5 w-3/5 rounded bg-[#DBEAFE]" />
              <div className="h-3.5 w-2/5 rounded bg-[#F2F4F6]" />
            </div>
          </div>
          {/* 2 stacked */}
          <div className="flex flex-col gap-4">
            {[0, 1].map(i => (
              <div key={i} className="flex-1 rounded-2xl overflow-hidden border border-[#F2F4F6]">
                <div className="aspect-[16/9] bg-[#EBF3FE]" />
                <div className="p-3 space-y-2">
                  <div className="h-3.5 w-4/5 rounded bg-[#DBEAFE]" />
                  <div className="h-3 w-2/5 rounded bg-[#F2F4F6]" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Destination chips */}
        <div className="flex gap-2 flex-wrap">
          {[52, 44, 56, 48, 44, 60, 52, 44].map((w, i) => (
            <div key={i} className="h-7 rounded-full bg-[#F2F4F6]" style={{ width: w }} />
          ))}
        </div>

        {/* Card grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-2xl overflow-hidden border border-[#F2F4F6]">
              <div className="aspect-[4/3] bg-[#EBF3FE]" />
              <div className="p-4 space-y-2">
                <div className="flex gap-2">
                  <div className="h-5 w-14 rounded-full bg-[#EBF3FE]" />
                  <div className="h-5 w-14 rounded-full bg-[#F2F4F6]" />
                </div>
                <div className="h-4 w-full rounded bg-[#DBEAFE]" />
                <div className="h-4 w-4/5 rounded bg-[#DBEAFE]" />
                <div className="h-3.5 w-1/3 rounded bg-[#F2F4F6]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
