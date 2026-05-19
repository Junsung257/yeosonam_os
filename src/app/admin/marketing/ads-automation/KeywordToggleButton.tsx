'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  keywordId: string;
  keyword: string;
  currentStatus: 'ACTIVE' | 'PAUSED' | 'FLAGGED_UP';
  platform: string;
}

export default function KeywordToggleButton({ keywordId, keyword, currentStatus, platform }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPaused = currentStatus === 'PAUSED';
  const action = isPaused ? 'RESUME' : 'PAUSE';
  const label = isPaused ? '▶ 재개' : '⏸ 일시정지';

  async function handleClick() {
    if (!confirm(`[${platform}] "${keyword}" 키워드를 ${action} 하시겠습니까?`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ads-automation/keyword-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywordId, action }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청 실패');
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`rounded px-2 py-1 text-xs font-medium transition ${
          loading
            ? 'cursor-wait bg-gray-200 text-gray-500'
            : isPaused
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
        }`}
      >
        {loading ? '...' : label}
      </button>
      {error && <span className="text-[10px] text-rose-600">⚠ {error}</span>}
    </div>
  );
}
