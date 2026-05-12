/** LP 라우트용 스켈레톤 — `loading.tsx` · `page` Suspense fallback 공용 */
export function LpRouteSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 animate-pulse">
      <div className="h-10 bg-orange-500/80" />

      <div className="relative h-[300px] md:h-[420px] bg-brand-light" />

      <div className="mx-auto max-w-lg px-4 py-6 space-y-5">
        <div className="space-y-2">
          <div className="h-7 w-5/6 rounded-lg bg-blue-100" />
          <div className="h-7 w-3/4 rounded-lg bg-blue-100" />
          <div className="h-4 w-1/2 rounded bg-bg-section" />
        </div>

        <div className="flex gap-2 flex-wrap">
          {[68, 80, 72, 76].map((w, i) => (
            <div key={i} className="h-7 rounded-full bg-brand-light" style={{ width: w }} />
          ))}
        </div>

        <div className="rounded-2xl border border-blue-200 bg-white p-5 space-y-3">
          <div className="h-4 w-24 rounded bg-bg-section" />
          <div className="h-8 w-40 rounded-lg bg-blue-100" />
          <div className="h-3.5 w-32 rounded bg-bg-section" />
          <div className="space-y-2 pt-1">
            {[100, 88, 94].map((w, i) => (
              <div key={i} className="h-3.5 rounded bg-bg-section" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>

        <div className="h-14 w-full rounded-2xl bg-brand/30" />
        <div className="h-11 w-full rounded-2xl bg-bg-section" />

        <div className="h-5 w-28 rounded bg-blue-100" />
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-xl border border-admin-border p-4 space-y-2">
            <div className="h-4 w-20 rounded bg-brand-light" />
            <div className="h-3.5 w-full rounded bg-bg-section" />
            <div className="h-3.5 w-4/5 rounded bg-bg-section" />
          </div>
        ))}
      </div>
    </div>
  );
}
