/**
 * AdminLayout 헤더용 알림 뱃지 (v3.6, 2026-04-30)
 *
 * 미해결 admin_alerts 카운트 → 빨간 dot + 숫자.
 * 클릭 시 /admin/alerts 로 이동.
 * 5분 polling (가벼움).
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function AlertsBadge() {
  const [count, setCount] = useState<number | null>(null);
  const [hasCritical, setHasCritical] = useState(false);

  useEffect(() => {
    let aborted = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = () => {
      fetch('/api/admin/alerts?showAcked=false')
        .then(r => r.ok ? r.json() : { alerts: [] })
        .then(d => {
          if (aborted) return;
          const arr = (d.alerts ?? []) as Array<{ severity: string }>;
          setCount(arr.length);
          setHasCritical(arr.some(a => a.severity === 'critical'));
        })
        .catch(() => {});
    };
    load();
    timer = setInterval(load, 5 * 60 * 1000); // 5분
    return () => { aborted = true; if (timer) clearInterval(timer); };
  }, []);

  if (count === null || count === 0) {
    return (
      <Link href="/admin/alerts"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded transition"
        title="운영 알림">
        <span>🔔</span>
      </Link>
    );
  }

  const critical = hasCritical;
  return (
    <Link href="/admin/alerts"
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition border ${
        critical
          ? 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100'
          : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 animate-pulse'
      }`}
      title={`미해결 알림 ${count}건${critical ? ' (critical 포함)' : ''}`}>
      <span>🔔</span>
      <span className="tabular-nums">{count}</span>
    </Link>
  );
}
