import Link from 'next/link';
import { WifiOff } from 'lucide-react';

export const metadata = {
  title: '오프라인',
};

export default function OfflinePage() {
  return (
    <main className="min-h-[100dvh] bg-slate-50 flex items-center justify-center px-6">
      <div className="text-center space-y-4 max-w-xs">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-200 text-slate-500">
          <WifiOff size={28} />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">오프라인입니다</h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          네트워크 연결이 끊어졌습니다.
          <br />
          연결이 복구되면 자동으로 최신 데이터를 불러옵니다.
        </p>
        <Link
          href="/m/admin"
          className="inline-block bg-slate-900 text-white text-sm font-medium px-5 py-2.5 rounded-xl active:scale-95 transition"
        >
          다시 시도
        </Link>
      </div>
    </main>
  );
}
