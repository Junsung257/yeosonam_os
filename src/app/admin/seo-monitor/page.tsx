import { Metadata } from 'next';
import SeoMonitorDashboard from './SeoMonitorDashboard';

export const metadata: Metadata = {
  title: 'SEO 모니터링',
  description: '실시간 SEO 모니터링 — 순위 변동·트래픽 알림·알고리즘 업데이트 감지',
};

export default function SeoMonitorPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">SEO 모니터링</h1>
        <p className="text-gray-500 text-sm mt-1">
          GSC 데이터 기반 일일 트래픽·순위 변동 감지 및 알림
        </p>
      </div>
      <SeoMonitorDashboard />
    </div>
  );
}
