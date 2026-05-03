export default function Loading() {
  return (
    <div className="min-h-screen bg-white animate-pulse">
      {/* Nav */}
      <div className="h-14 md:h-16 border-b border-[#F2F4F6] bg-white" />

      {/* Breadcrumb */}
      <div className="mx-auto max-w-6xl px-4 pt-4 pb-2 flex items-center gap-2">
        <div className="h-3.5 w-10 rounded bg-[#F2F4F6]" />
        <div className="h-3 w-3 rounded bg-[#F2F4F6]" />
        <div className="h-3.5 w-16 rounded bg-[#F2F4F6]" />
        <div className="h-3 w-3 rounded bg-[#F2F4F6]" />
        <div className="h-3.5 w-24 rounded bg-[#F2F4F6]" />
      </div>

      {/* Header */}
      <header className="mx-auto max-w-6xl px-4 pt-4 pb-6">
        <div className="h-5 w-20 rounded-full bg-[#EBF3FE] mb-3" />
        <div className="space-y-2 mb-4">
          <div className="h-8 md:h-10 bg-[#DBEAFE] rounded-lg w-full max-w-2xl" />
          <div className="h-8 md:h-10 bg-[#DBEAFE] rounded-lg w-3/4 max-w-xl" />
        </div>
        <div className="h-4 w-48 rounded bg-[#F2F4F6]" />
      </header>

      {/* Hero image */}
      <div className="mx-auto max-w-3xl px-4 mb-8">
        <div className="aspect-[16/9] w-full rounded-md bg-[#EBF3FE]" />
      </div>

      {/* Body + sidebar */}
      <div className="mx-auto max-w-6xl px-4 lg:flex lg:gap-12">
        {/* Article */}
        <div className="min-w-0 flex-1 lg:max-w-[720px] space-y-4 pb-12">
          {/* TL;DR box */}
          <div className="rounded-2xl border border-[#DBEAFE] bg-[#EBF3FE]/70 p-5 space-y-2">
            <div className="h-4 w-16 rounded bg-[#3182F6]/30" />
            {[90, 75, 85].map((w, i) => (
              <div key={i} className="h-3.5 rounded bg-[#DBEAFE]" style={{ width: `${w}%` }} />
            ))}
          </div>
          {/* Body paragraphs */}
          {[100, 95, 88, 100, 92, 80, 96, 70].map((w, i) => (
            <div key={i} className="h-3.5 rounded bg-[#F2F4F6]" style={{ width: `${w}%` }} />
          ))}
          <div className="h-3.5 rounded bg-[#F2F4F6] w-1/2" />
          <div className="py-2" />
          {[100, 94, 88, 97, 75].map((w, i) => (
            <div key={i} className="h-3.5 rounded bg-[#F2F4F6]" style={{ width: `${w}%` }} />
          ))}
          {/* Curation block */}
          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3">
            <div className="h-4 w-28 rounded bg-[#EBF3FE]" />
            <div className="h-6 w-48 rounded-lg bg-[#DBEAFE]" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="aspect-[4/3] bg-[#EBF3FE]" />
                  <div className="p-3 space-y-2">
                    <div className="h-3.5 rounded bg-[#F2F4F6] w-4/5" />
                    <div className="h-3 rounded bg-[#F2F4F6] w-3/5" />
                    <div className="h-5 rounded bg-[#DBEAFE] w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="hidden lg:block lg:w-[280px] shrink-0 space-y-4 pt-1">
          <div className="sticky top-20 space-y-4">
            <div className="rounded-xl border border-[#F2F4F6] bg-[#F8FAFC] p-4 space-y-2">
              <div className="h-4 w-20 rounded bg-[#EBF3FE]" />
              {[85, 70, 90, 60, 75].map((w, i) => (
                <div key={i} className="h-3 rounded bg-[#F2F4F6]" style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="aspect-[4/3] bg-[#EBF3FE]" />
              <div className="p-3 space-y-2">
                <div className="h-4 w-4/5 rounded bg-[#DBEAFE]" />
                <div className="h-3 w-3/5 rounded bg-[#F2F4F6]" />
                <div className="h-8 w-full rounded-lg bg-[#3182F6]/20" />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
