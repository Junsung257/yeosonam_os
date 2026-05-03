export default function Loading() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] animate-pulse pb-12">
      {/* Nav */}
      <div className="h-14 md:h-16 border-b border-[#F2F4F6] bg-white" />

      <div className="mx-auto max-w-lg px-4 pt-6 space-y-4">
        {/* Grade card */}
        <div className="rounded-2xl bg-gradient-to-br from-[#EBF3FE] to-[#DBEAFE] p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-[#3182F6]/20" />
            <div className="space-y-1.5">
              <div className="h-4 w-28 rounded bg-[#3182F6]/30" />
              <div className="h-3 w-20 rounded bg-[#3182F6]/20" />
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-2.5 w-full rounded-full bg-white/60">
            <div className="h-full w-2/3 rounded-full bg-[#3182F6]/40" />
          </div>
          <div className="h-3 w-40 rounded bg-[#3182F6]/20" />
        </div>

        {/* Mileage stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-xl bg-white border border-[#F2F4F6] p-3 space-y-1.5 text-center">
              <div className="h-3 w-12 mx-auto rounded bg-[#F2F4F6]" />
              <div className="h-5 w-16 mx-auto rounded bg-[#DBEAFE]" />
            </div>
          ))}
        </div>

        {/* Section title */}
        <div className="h-5 w-24 rounded bg-[#DBEAFE] mt-2" />

        {/* Booking cards */}
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl bg-white border border-[#F2F4F6] p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-40 rounded bg-[#DBEAFE]" />
                <div className="h-3.5 w-24 rounded bg-[#F2F4F6]" />
              </div>
              <div className="h-6 w-16 rounded-full bg-[#EBF3FE]" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-3 w-20 rounded bg-[#F2F4F6]" />
              <div className="h-3 w-16 rounded bg-[#F2F4F6]" />
            </div>
            <div className="h-9 w-full rounded-xl bg-[#EBF3FE]" />
          </div>
        ))}

        {/* Logout button */}
        <div className="h-10 w-full rounded-xl bg-[#F2F4F6]" />
      </div>
    </div>
  );
}
