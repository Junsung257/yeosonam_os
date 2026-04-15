export default function Loading() {
  return (
    <div className="min-h-screen bg-white max-w-lg mx-auto">
      <div className="bg-gradient-to-b from-[#340897] to-[#4b2ead] px-5 pt-10 pb-8 text-center">
        <div className="h-8 w-40 bg-white/20 rounded-full mx-auto mb-3 animate-pulse" />
        <div className="h-8 w-24 bg-white/30 rounded mx-auto mb-1 animate-pulse" />
        <div className="h-4 w-44 bg-white/15 rounded mx-auto animate-pulse" />
      </div>
      <div className="px-4 -mt-6">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4">
          <div className="h-5 w-24 bg-gray-200 rounded mb-3 animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden border border-gray-100">
                <div className="h-28 bg-gray-200 animate-pulse" />
                <div className="px-2.5 py-2">
                  <div className="h-5 w-20 bg-gray-200 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
