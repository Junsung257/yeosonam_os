import { Metadata } from 'next';
import WebVitalsDashboard from './WebVitalsDashboard';

export const metadata: Metadata = {
  title: 'Web Vitals 모니터링',
  description: '실제 사용자 Core Web Vitals (LCP/CLS/INP/FCP) 모니터링 대시보드',
};

export default function WebVitalsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Web Vitals 모니터링</h1>
        <p className="text-gray-500 text-sm mt-1">
          실제 사용자 기준 Core Web Vitals (LCP·CLS·INP·FCP·TTFB)
        </p>
      </div>
      <WebVitalsDashboard />
    </div>
  );
}
