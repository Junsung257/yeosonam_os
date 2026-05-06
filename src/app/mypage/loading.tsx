export default function Loading() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] animate-pulse pb-12">
      {/* Nav */}
      <div className="h-14 md:h-16 border-b border-admin-border bg-white" />

      <div className="mx-auto max-w-lg px-4 pt-6 space-y-4">
        {/* Grade card */}
        <div className="rounded-2xl bg-gradient-to-br from-brand-light to-[#DBEAFE] p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-brand/20" />
            <div className="space-y-1.5">
              <div className="h-4 w-28 rounded bg-brand/30" />
              <div className="h-3 w-20 rounded bg-brand/20" />
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-2.5 w-full rounded-full bg-white/60">
            <div className="h-full w-2/3 rounded-full bg-brand/40" />
          </div>
          <div className="h-3 w-40 rounded bg-brand/20" />
        </div>

        {/* Mileage stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-xl bg-white border border-admin-border p-3 space-y-1.5 text-center">
              <div className="h-3 w-12 mx-auto rounded bg-bg-section" />
              <div className="h-5 w-16 mx-auto rounded bg-blue-100" />
            </div>
          ))}
        </div>

        {/* Section title */}
        <div className="h-5 w-24 rounded bg-blue-100 mt-2" />

        {/* Booking cards */}
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl bg-white border border-admin-border p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-40 rounded bg-blue-100" />
                <div className="h-3.5 w-24 rounded bg-bg-section" />
              </div>
              <div className="h-6 w-16 rounded-full bg-brand-light" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-3 w-20 rounded bg-bg-section" />
              <div className="h-3 w-16 rounded bg-bg-section" />
            </div>
            <div className="h-9 w-full rounded-xl bg-brand-light" />
          </div>
        ))}

        {/* Logout button */}
        <div className="h-10 w-full rounded-xl bg-bg-section" />
      </div>
    </div>
  );
}
