'use client';

export default function PrintBar({ title }: { title: string }) {
  return (
    <div className="print:hidden sticky top-0 z-10 bg-gray-800 text-white px-6 py-2 flex items-center justify-between text-sm">
      <span className="font-bold text-white/90">📄 {title}</span>
      <button
        onClick={() => window.print()}
        className="bg-blue-500 hover:bg-blue-400 text-white px-4 py-1.5 rounded font-medium transition text-xs"
      >
        🖨 인쇄 / PDF 저장
      </button>
    </div>
  );
}
