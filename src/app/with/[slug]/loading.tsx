export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 animate-pulse">
      {/* Nav */}
      <div className="h-14 md:h-16 border-b border-[#F2F4F6] bg-white" />

      {/* Affiliate intro section */}
      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
          <div className="flex items-center gap-4 mb-5">
            <div className="h-16 w-16 rounded-full bg-[#EBF3FE] shrink-0" />
            <div className="space-y-2">
              <div className="h-5 w-32 rounded bg-[#DBEAFE]" />
              <div className="h-3.5 w-20 rounded bg-[#F2F4F6]" />
            </div>
          </div>
          <div className="space-y-2 max-w-xl">
            <div className="h-3.5 w-full rounded bg-[#F2F4F6]" />
            <div className="h-3.5 w-5/6 rounded bg-[#F2F4F6]" />
            <div className="h-3.5 w-4/5 rounded bg-[#F2F4F6]" />
          </div>
        </div>
      </section>

      {/* Package cards */}
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="h-6 w-32 rounded-lg bg-[#DBEAFE] mb-5" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white border border-[#F2F4F6] overflow-hidden">
              <div className="h-40 bg-[#EBF3FE]" />
              <div className="p-4 space-y-2">
                <div className="h-4 w-full rounded bg-[#DBEAFE]" />
                <div className="h-4 w-3/4 rounded bg-[#DBEAFE]" />
                <div className="h-3 w-2/5 rounded bg-[#F2F4F6]" />
                <div className="flex items-center justify-between pt-1">
                  <div className="h-6 w-20 rounded bg-[#EBF3FE]" />
                  <div className="h-8 w-20 rounded-lg bg-[#3182F6]/20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
